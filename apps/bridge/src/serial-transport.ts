import { SERIAL } from "@aperture/shared";
import type { Logger } from "pino";

import type { LineTransport } from "./transport.ts";

/**
 * The real USB link (PRD §7.1, §7.8).
 *
 * `serialport` is imported lazily so that `--mock` keeps working on a machine
 * where the native bindings are unavailable — the whole point of mock mode is
 * that it needs nothing from the hardware world.
 */

/** Manufacturer strings reported by the usual Uno and clone USB bridges. */
const KNOWN_MANUFACTURERS = /arduino|wch|ch340|ch910|ftdi|silicon\s?labs|cp210/i;

export interface PortCandidate {
  path: string;
  manufacturer?: string | undefined;
}

export async function listCandidatePorts(): Promise<PortCandidate[]> {
  const { SerialPort } = await import("serialport");
  const ports = await SerialPort.list();

  return ports
    .map((port) => ({ path: port.path, manufacturer: port.manufacturer }))
    .sort((a, b) => {
      const aKnown = KNOWN_MANUFACTURERS.test(a.manufacturer ?? "") ? 0 : 1;
      const bKnown = KNOWN_MANUFACTURERS.test(b.manufacturer ?? "") ? 0 : 1;
      return aKnown - bKnown;
    });
}

/** Picks the most likely board, preferring a recognised manufacturer. */
export async function discoverPort(preferred?: string): Promise<string | null> {
  if (preferred !== undefined) return preferred;
  const [best] = await listCandidatePorts();
  return best?.path ?? null;
}

export class SerialTransport implements LineTransport {
  #port: import("serialport").SerialPort | null = null;
  #lineHandlers: ((line: string) => void)[] = [];
  #closeHandlers: ((reason: Error | null) => void)[] = [];

  readonly name: string;
  readonly #baudRate: number;
  readonly #logger: Logger;

  constructor(name: string, baudRate: number, logger: Logger) {
    this.name = name;
    this.#baudRate = baudRate;
    this.#logger = logger;
  }

  async open(): Promise<void> {
    const { SerialPort } = await import("serialport");
    const { ReadlineParser } = await import("@serialport/parser-readline");

    const port = new SerialPort({ path: this.name, baudRate: this.#baudRate, autoOpen: false });
    this.#port = port;

    await new Promise<void>((resolve, reject) => {
      port.open((error) => (error ? reject(error) : resolve()));
    });

    const parser = port.pipe(new ReadlineParser({ delimiter: SERIAL.delimiter }));
    parser.on("data", (line: string) => {
      for (const handler of this.#lineHandlers) handler(line);
    });

    port.on("error", (error: Error) => {
      this.#logger.warn({ err: error }, "serial error");
      for (const handler of this.#closeHandlers) handler(error);
    });

    port.on("close", () => {
      for (const handler of this.#closeHandlers) handler(null);
    });
  }

  async close(): Promise<void> {
    const port = this.#port;
    this.#port = null;
    if (port === null || !port.isOpen) return;
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }

  write(line: string): void {
    if (this.#port === null || !this.#port.isOpen) {
      this.#logger.warn({ line }, "dropped a command: serial port is not open");
      return;
    }
    this.#port.write(`${line}${SERIAL.delimiter}`);
  }

  onLine(handler: (line: string) => void): void {
    this.#lineHandlers.push(handler);
  }

  onClose(handler: (reason: Error | null) => void): void {
    this.#closeHandlers.push(handler);
  }
}
