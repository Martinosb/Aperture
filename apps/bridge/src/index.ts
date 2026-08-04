import { SERIAL, type DesiredState, type ReportedState, type Telemetry } from "@aperture/shared";
import { Command as Cli } from "commander";
import type { Logger } from "pino";

import { Board } from "./board.ts";
import { loadConfig } from "./config.ts";
import { DeviceSync } from "./firebase.ts";
import { createLogger } from "./logger.ts";
import { MOCK_DEFAULTS, MockBoard, type MockScenario } from "./mock-board.ts";
import { shouldPublish } from "./publisher.ts";
import { SerialTransport, discoverPort } from "./serial-transport.ts";
import { renderStatusLine, writeStatusLine } from "./status.ts";
import { composeReported, diffDesired, type KnownLimits } from "./state.ts";
import type { LineTransport } from "./transport.ts";

const BRIDGE_VERSION = "1.0.0";

interface CliOptions {
  mock: boolean;
  port?: string;
  daySeconds: string;
  startPhase: string;
  scenario: MockScenario;
}

async function main(): Promise<void> {
  const cli = new Cli()
    .name("aperture-bridge")
    .description("Relays state between the Aperture window unit and Firebase")
    .version(BRIDGE_VERSION)
    .option("--mock", "run with synthetic telemetry and no hardware attached", false)
    .option("--port <path>", "serial port to use instead of auto-discovery")
    .option(
      "--day-seconds <seconds>",
      "real seconds one simulated day lasts in mock mode",
      String(MOCK_DEFAULTS.daySeconds),
    )
    .option(
      "--start-phase <fraction>",
      "time of day the mock starts at: 0 is midnight, 0.5 is noon",
      String(MOCK_DEFAULTS.startPhase),
    )
    .option("--scenario <name>", "mock scenario: normal or fault", MOCK_DEFAULTS.scenario)
    .parse();

  const options = cli.opts<CliOptions>();
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);

  const sync = new DeviceSync(config, logger, BRIDGE_VERSION);
  await sync.primeEventCount();

  const runtime = new Bridge(sync, logger, options, config.SERIAL_BAUD);
  await runtime.start();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    await runtime.stop();
    await sync.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/**
 * Owns the lifecycle: connect to the board, mirror telemetry up, push intent
 * down, and survive the link disappearing (PRD §7.7, §7.8).
 */
class Bridge {
  #board: Board | null = null;
  #stopped = false;
  #reconnectTimer: NodeJS.Timeout | null = null;

  #lastDesired: DesiredState | null = null;
  #lastReported: ReportedState | null = null;
  #limits: KnownLimits = { tempLimit: 26, lightLimit: 700, overrideTimeoutMin: 15 };
  #seeded = false;

  readonly #sync: DeviceSync;
  readonly #logger: Logger;
  readonly #options: CliOptions;
  readonly #baudRate: number;

  constructor(sync: DeviceSync, logger: Logger, options: CliOptions, baudRate: number) {
    this.#sync = sync;
    this.#logger = logger;
    this.#options = options;
    this.#baudRate = baudRate;
  }

  async start(): Promise<void> {
    this.#sync.onDesired((desired) => void this.#applyDesired(desired));
    await this.#connect();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    await this.#board?.close();
  }

  async #createTransport(): Promise<LineTransport | null> {
    if (this.#options.mock) {
      const daySeconds = Number(this.#options.daySeconds);
      const startPhase = Number(this.#options.startPhase);
      return new MockBoard({
        daySeconds: Number.isFinite(daySeconds) && daySeconds > 0 ? daySeconds : MOCK_DEFAULTS.daySeconds,
        scenario: this.#options.scenario === "fault" ? "fault" : "normal",
        startPhase:
          Number.isFinite(startPhase) && startPhase >= 0 && startPhase < 1
            ? startPhase
            : MOCK_DEFAULTS.startPhase,
      });
    }

    const path = await discoverPort(this.#options.port);
    if (path === null) {
      this.#logger.warn("no Arduino-like serial port found");
      return null;
    }
    return new SerialTransport(path, this.#baudRate, this.#logger);
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;

    let transport: LineTransport | null = null;
    try {
      transport = await this.#createTransport();
    } catch (error) {
      this.#logger.error({ err: error }, "could not enumerate serial ports");
    }

    if (transport === null) {
      this.#scheduleReconnect();
      return;
    }

    const board = new Board(transport, this.#logger);
    this.#board = board;

    board.onTelemetry((telemetry) => this.#onTelemetry(telemetry));
    board.onEvent((event) => {
      void this.#sync.pushEvent(
        event.kind,
        event.position ?? Math.round(this.#lastReported?.position ?? 0),
        event.message,
      );
      this.#logger.info({ kind: event.kind }, event.message);
    });
    board.onReady((firmware) => void this.#onReady(firmware));
    board.onClosed((reason) => {
      if (this.#stopped) return;
      this.#logger.warn({ reason: reason?.message ?? "clean close" }, "link lost");
      this.#sync.setSerialPort(null);
      this.#scheduleReconnect();
    });

    try {
      await board.open();
    } catch (error) {
      this.#logger.error({ err: error, port: transport.name }, "could not open the link");
      this.#scheduleReconnect();
      return;
    }

    this.#logger.info({ port: transport.name }, "connected to the window unit");
    this.#sync.startPresence(transport.name);
    this.#sync.setSerialPort(transport.name);
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer !== null) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect();
    }, SERIAL.reconnectIntervalMs);
  }

  /**
   * A board that has just reset has its EEPROM thresholds but may have lost mode
   * state, so the whole of `/desired` is pushed back (PRD §7.7).
   */
  async #onReady(firmware: string): Promise<void> {
    this.#logger.info({ firmware }, "board reset — re-pushing desired state");
    await this.#sync.ensureMeta(firmware);

    const desired = await this.#sync.readDesired();
    if (desired === null) return;

    this.#lastDesired = null; // force a full re-push
    await this.#applyDesired(desired);
  }

  #onTelemetry(telemetry: Telemetry): void {
    const now = Date.now();
    const reported = composeReported(telemetry, this.#limits, this.#lastReported, now);
    this.#lastReported = reported;

    writeStatusLine(renderStatusLine(reported, this.#board?.portName ?? null, true));

    if (!this.#seeded) {
      this.#seeded = true;
      void this.#sync.seedDesiredIfAbsent(reported);
    }

    if (shouldPublish(this.#sync.lastPublished, reported, this.#sync.msSinceLastWrite)) {
      this.#sync.publish(reported);
    }
  }

  async #applyDesired(desired: DesiredState): Promise<void> {
    this.#limits = {
      tempLimit: desired.tempLimit,
      lightLimit: desired.lightLimit,
      overrideTimeoutMin: desired.overrideTimeoutMin,
    };

    const commands = diffDesired(this.#lastDesired, desired, this.#lastReported);
    this.#lastDesired = desired;
    if (commands.length === 0) return;

    const board = this.#board;
    if (board === null) {
      this.#logger.warn({ count: commands.length }, "no link — dropping commands");
      return;
    }

    for (const command of commands) {
      try {
        await board.send(command);
        this.#logger.debug({ command }, "acknowledged");
      } catch (error) {
        this.#logger.error({ err: error, command }, "command failed after retry");
        await this.#sync.pushEvent(
          "alert",
          Math.round(this.#lastReported?.position ?? 0),
          "The window unit did not acknowledge a command",
        );
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
