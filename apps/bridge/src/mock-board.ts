import {
  DEFAULTS,
  HYSTERESIS,
  RANGES,
  SERIAL,
  clamp,
  formatAck,
  formatError,
  formatEvent,
  formatReady,
  formatState,
  parseCommand,
  type Telemetry,
} from "@aperture/shared";

import type { LineTransport } from "./transport.ts";

/**
 * A virtual Arduino that speaks the real wire protocol (PRD §7 mock mode).
 *
 * It mirrors the firmware's automation logic — the same thresholds, the same
 * hysteresis bands, the same override timeout — so the entire software stack can
 * be built and demonstrated with nothing plugged in. Because it exchanges actual
 * protocol strings rather than typed objects, the bridge's parsing and ACK
 * handling get exercised exactly as they will be against real hardware.
 */

/** Blind position the automation drives to in each thermal state. */
const AUTO_TARGET_CLOSED = 18;
const AUTO_TARGET_OPEN = 88;

/** Stepper travel rate, percent per second. */
const MOTOR_SPEED_PCT_PER_SEC = 45;

/** Simulation tick. Fine enough for smooth motion, coarse enough to stay cheap. */
const TICK_MS = 100;

const FIRMWARE_VERSION = "2.4.1";

export type MockScenario = "normal" | "fault";

export interface MockBoardOptions {
  /** Real seconds one simulated day lasts. Short values make automation visible. */
  daySeconds: number;
  scenario: MockScenario;
  /** Simulated clock start, as a fraction of a day (0 = midnight, 0.5 = noon). */
  startPhase: number;
}

export const MOCK_DEFAULTS: MockBoardOptions = {
  daySeconds: 600,
  scenario: "normal",
  startPhase: 0.42,
};

export class MockBoard implements LineTransport {
  readonly name = "mock";

  #lineHandlers: ((line: string) => void)[] = [];
  #closeHandlers: ((reason: Error | null) => void)[] = [];
  #tick: NodeJS.Timeout | null = null;
  #telemetry: NodeJS.Timeout | null = null;
  #startedAt = 0;

  // Thresholds live in "EEPROM" and survive everything except a fresh process.
  #tempLimit: number = DEFAULTS.tempLimit;
  #lightLimit: number = DEFAULTS.lightLimit;
  #overrideTimeoutMin: number = DEFAULTS.overrideTimeoutMin;

  #position = 62;
  #target = 62;
  #mode: "auto" | "manual" = "auto";
  #motorState: Telemetry["motorState"] = "idle";
  #heatProtection = false;
  #overrideEndsAt: number | null = null;

  #temperature = 24;
  #humidity = 58;
  #light = 500;
  #battery = 78;

  #faultArmed: boolean;

  readonly #options: MockBoardOptions;

  constructor(options: MockBoardOptions = MOCK_DEFAULTS) {
    this.#options = options;
    this.#faultArmed = options.scenario === "fault";
  }

  async open(): Promise<void> {
    this.#startedAt = Date.now();
    this.#syncSensors(0);
    this.#temperature = this.#targetTemperature();
    this.#humidity = this.#targetHumidity();

    // A real board sends READY a moment after reset, once its peripherals settle.
    setTimeout(() => this.#emit(formatReady(FIRMWARE_VERSION)), 120);

    this.#tick = setInterval(() => this.#step(), TICK_MS);
    this.#telemetry = setInterval(
      () => this.#emit(formatState(this.snapshot())),
      SERIAL.telemetryIntervalMs,
    );
  }

  async close(): Promise<void> {
    if (this.#tick !== null) clearInterval(this.#tick);
    if (this.#telemetry !== null) clearInterval(this.#telemetry);
    this.#tick = null;
    this.#telemetry = null;
    for (const handler of this.#closeHandlers) handler(null);
  }

  write(line: string): void {
    const command = parseCommand(line);

    if (command === null) {
      // The firmware ignores anything it does not recognise rather than halting,
      // but it does answer a malformed SET so the bridge is not left waiting.
      if (line.trim().startsWith("SET")) {
        this.#emit(formatError(line.trim(), "out_of_range"));
      }
      return;
    }

    switch (command.kind) {
      case "ping":
        this.#emit("PONG");
        return;

      case "position":
        this.#enterManual();
        this.#target = command.value;
        this.#emit(formatAck(`SET P:${Math.round(command.value)}`));
        this.#emitEvent(
          "manual",
          Math.round(command.value),
          `Set to ${Math.round(command.value)} percent from the app`,
        );
        return;

      case "mode":
        if (command.value === "auto") {
          this.#mode = "auto";
          this.#overrideEndsAt = null;
          // Clearing a fault is what resuming automation is for.
          if (this.#motorState === "fault") {
            this.#motorState = "idle";
            this.#faultArmed = false;
          }
        } else {
          this.#enterManual();
        }
        this.#emit(formatAck(`SET MODE:${command.value === "auto" ? "AUTO" : "MANUAL"}`));
        return;

      case "tempLimit":
        this.#tempLimit = command.value;
        this.#emit(formatAck(`SET TLIM:${Math.round(command.value)}`));
        return;

      case "lightLimit":
        this.#lightLimit = command.value;
        this.#emit(formatAck(`SET LLIM:${Math.round(command.value)}`));
        return;

      case "overrideTimeoutMin":
        this.#overrideTimeoutMin = command.value;
        this.#emit(formatAck(`SET TIMEOUT:${Math.round(command.value)}`));
        return;
    }
  }

  onLine(handler: (line: string) => void): void {
    this.#lineHandlers.push(handler);
  }

  onClose(handler: (reason: Error | null) => void): void {
    this.#closeHandlers.push(handler);
  }

  /** Current readings, in the shape a STATE line carries. */
  snapshot(): Telemetry {
    return {
      temperature: Math.round(this.#temperature * 10) / 10,
      humidity: Math.round(this.#humidity),
      light: Math.round(this.#light),
      position: Math.round(this.#position),
      mode: this.#mode,
      motorState: this.#motorState,
      heatProtection: this.#heatProtection,
      battery: Math.round(this.#battery),
    };
  }

  #emit(line: string): void {
    for (const handler of this.#lineHandlers) handler(line);
  }

  #emitEvent(kind: "auto" | "manual" | "alert", position: number | null, message: string): void {
    this.#emit(formatEvent({ kind, position, message }));
  }

  #enterManual(): void {
    this.#mode = "manual";
    this.#overrideEndsAt = Date.now() + this.#overrideTimeoutMin * 60_000;
  }

  /** Fraction of the simulated day elapsed: 0 is midnight, 0.5 is noon. */
  #phase(elapsedMs: number): number {
    const dayMs = this.#options.daySeconds * 1000;
    return (this.#options.startPhase + elapsedMs / dayMs) % 1;
  }

  /** Height of the sun above the horizon, 0 at night, 1 at noon. */
  #sunElevation(elapsedMs: number): number {
    return Math.max(0, Math.sin((this.#phase(elapsedMs) - 0.25) * 2 * Math.PI));
  }

  #targetTemperature(): number {
    const elevation = this.#sunElevation(Date.now() - this.#startedAt);
    // Closed slats admit less heat, so the room the blinds protect really does
    // run cooler. Hysteresis keeps that feedback from turning into oscillation.
    const openFraction = this.#position / 100;
    return 20.5 + elevation * 9.5 * (0.5 + 0.5 * openFraction);
  }

  #targetHumidity(): number {
    return 70 - this.#sunElevation(Date.now() - this.#startedAt) * 18;
  }

  #syncSensors(dt: number): void {
    const elapsed = Date.now() - this.#startedAt;
    const elevation = this.#sunElevation(elapsed);

    const jitter = (Math.random() - 0.5) * 2;
    this.#light = Math.max(0, Math.pow(elevation, 1.2) * 1150 + jitter * 6);

    // First-order lag so the room warms and cools gradually rather than snapping.
    const lag = 1 - Math.exp(-dt / 4000);
    this.#temperature += (this.#targetTemperature() - this.#temperature) * lag;
    this.#humidity += (this.#targetHumidity() - this.#humidity) * lag;

    const simulatedHours = (dt / 1000 / this.#options.daySeconds) * 24;
    this.#battery = Math.max(5, this.#battery - simulatedHours * 1.0);
  }

  #step(): void {
    this.#syncSensors(TICK_MS);
    this.#runAutomation();
    this.#driveMotor();
  }

  /** FR-1.1, FR-1.2 and FR-1.7 — the decision the board makes on its own. */
  #runAutomation(): void {
    if (this.#mode === "manual") {
      if (this.#overrideEndsAt !== null && Date.now() >= this.#overrideEndsAt) {
        this.#mode = "auto";
        this.#overrideEndsAt = null;
        this.#emitEvent("auto", Math.round(this.#position), "Automation resumed after manual override");
      }
      return;
    }

    // Engaging needs both readings above the upper band; releasing needs them
    // below the lower band. Without that gap a reading sitting on the threshold
    // makes the blinds hunt for minutes.
    const engaged = this.#heatProtection;
    const tempTrigger = engaged
      ? this.#tempLimit - HYSTERESIS.temperatureC
      : this.#tempLimit + HYSTERESIS.temperatureC;
    const lightTrigger = engaged
      ? this.#lightLimit - HYSTERESIS.lightLux
      : this.#lightLimit + HYSTERESIS.lightLux;

    const heatGain = this.#temperature > tempTrigger && this.#light > lightTrigger;
    if (heatGain === this.#heatProtection) return;

    this.#heatProtection = heatGain;
    const target = heatGain ? AUTO_TARGET_CLOSED : AUTO_TARGET_OPEN;
    if (Math.round(target) === Math.round(this.#target)) return;

    this.#target = target;
    this.#emitEvent(
      "auto",
      target,
      heatGain
        ? `Closed to ${target} percent - room hit ${this.#temperature.toFixed(0)}C in direct sun`
        : `Opened to ${target} percent - light dropped to ${Math.round(this.#light)} lux`,
    );
  }

  #driveMotor(): void {
    const distance = this.#target - this.#position;

    if (Math.abs(distance) < 0.5) {
      this.#position = this.#target;
      if (this.#motorState === "moving") this.#motorState = "idle";
      return;
    }

    // FR-1.9 — a commanded move that cannot complete is reported, not retried
    // forever. Resuming automation clears it.
    if (this.#faultArmed && Math.abs(distance) > 30) {
      this.#faultArmed = false;
      this.#motorState = "fault";
      this.#target = this.#position;
      this.#emitEvent("alert", null, "Stepper stall detected");
      return;
    }

    if (this.#motorState === "fault") return;

    this.#motorState = "moving";
    const stepSize = (MOTOR_SPEED_PCT_PER_SEC * TICK_MS) / 1000;
    const stepped = this.#position + Math.sign(distance) * Math.min(stepSize, Math.abs(distance));
    this.#position = clamp(stepped, RANGES.position);
  }
}
