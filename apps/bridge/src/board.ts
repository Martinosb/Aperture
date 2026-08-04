import {
  SERIAL,
  formatCommand,
  parseInbound,
  type Command,
  type SerialEvent,
  type Telemetry,
} from "@aperture/shared";
import type { Logger } from "pino";

import type { LineTransport } from "./transport.ts";

/**
 * The protocol client: turns a stream of lines into typed events, and turns
 * commands into acknowledged writes.
 *
 * Commands are sent one at a time. An ACK echoes the command it answers, so
 * serialising the queue keeps matching unambiguous — and at 9600 baud there is
 * nothing to gain from overlapping writes anyway.
 */
export class Board {
  #telemetryHandlers: ((telemetry: Telemetry) => void)[] = [];
  #eventHandlers: ((event: SerialEvent) => void)[] = [];
  #readyHandlers: ((firmware: string) => void)[] = [];
  #closedHandlers: ((reason: Error | null) => void)[] = [];

  #pending: { command: string; resolve: () => void; reject: (error: Error) => void } | null = null;
  #queue: (() => void)[] = [];

  readonly #transport: LineTransport;
  readonly #logger: Logger;

  constructor(transport: LineTransport, logger: Logger) {
    this.#transport = transport;
    this.#logger = logger;

    transport.onLine((line) => this.#receive(line));
    transport.onClose((reason) => {
      this.#failPending(new Error("link closed"));
      for (const handler of this.#closedHandlers) handler(reason);
    });
  }

  get portName(): string {
    return this.#transport.name;
  }

  async open(): Promise<void> {
    await this.#transport.open();
  }

  async close(): Promise<void> {
    await this.#transport.close();
  }

  onTelemetry(handler: (telemetry: Telemetry) => void): void {
    this.#telemetryHandlers.push(handler);
  }

  onEvent(handler: (event: SerialEvent) => void): void {
    this.#eventHandlers.push(handler);
  }

  onReady(handler: (firmware: string) => void): void {
    this.#readyHandlers.push(handler);
  }

  onClosed(handler: (reason: Error | null) => void): void {
    this.#closedHandlers.push(handler);
  }

  /**
   * Sends a command and resolves once the board acknowledges it. Retries once on
   * timeout (PRD §5); the caller records an alert if it still fails.
   */
  async send(command: Command): Promise<void> {
    const line = formatCommand(command);

    for (let attempt = 0; attempt <= SERIAL.ackRetries; attempt += 1) {
      try {
        await this.#sendOnce(line);
        return;
      } catch (error) {
        const last = attempt === SERIAL.ackRetries;
        this.#logger.warn({ line, attempt: attempt + 1, err: error }, "command not acknowledged");
        if (last) throw error;
      }
    }
  }

  #sendOnce(line: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const run = (): void => {
        const timer = setTimeout(() => {
          if (this.#pending?.command === line) {
            this.#pending = null;
            reject(new Error(`no ACK for "${line}" within ${SERIAL.ackTimeoutMs}ms`));
            this.#drain();
          }
        }, SERIAL.ackTimeoutMs);

        this.#pending = {
          command: line,
          resolve: () => {
            clearTimeout(timer);
            resolve();
            this.#drain();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
            this.#drain();
          },
        };

        this.#transport.write(line);
      };

      if (this.#pending === null) run();
      else this.#queue.push(run);
    });
  }

  #drain(): void {
    this.#pending = null;
    const next = this.#queue.shift();
    if (next !== undefined) next();
  }

  #failPending(error: Error): void {
    const pending = this.#pending;
    this.#pending = null;
    this.#queue = [];
    pending?.reject(error);
  }

  #receive(line: string): void {
    const message = parseInbound(line);

    // A garbled byte must never wedge the bridge; log it and move on.
    if (message === null) {
      if (line.trim() !== "") this.#logger.debug({ line }, "ignoring unrecognised line");
      return;
    }

    switch (message.type) {
      case "state":
        for (const handler of this.#telemetryHandlers) handler(message.telemetry);
        return;

      case "event":
        for (const handler of this.#eventHandlers) handler(message.event);
        return;

      case "ready":
        for (const handler of this.#readyHandlers) handler(message.firmware);
        return;

      case "ack":
        if (this.#pending?.command === message.command) this.#pending.resolve();
        else this.#logger.debug({ ack: message.command }, "unexpected ACK");
        return;

      case "error":
        if (this.#pending?.command === message.command) {
          this.#pending.reject(new Error(`board rejected "${message.command}": ${message.reason}`));
        }
        return;

      case "pong":
        return;
    }
  }
}
