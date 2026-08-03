/**
 * Serial protocol between the desktop bridge and the Arduino (PRD §5), plus the
 * value ranges and publish thresholds both processes must agree on.
 *
 * The wire format is newline-delimited plain text so it can be debugged in the
 * Arduino Serial Monitor with no tooling. It is declared once here; the bridge
 * must not re-implement parsing, and the firmware must match these shapes byte
 * for byte.
 *
 * Two rules from the PRD are encoded structurally rather than left to callers:
 *   - Unrecognised input returns `null` instead of throwing, so a garbled byte
 *     on the wire can never wedge either process.
 *   - `formatCommand` clamps and rounds every value, so an out-of-range number
 *     from the network cannot reach the board even if a caller forgets to check.
 */

import type { BlindMode, EventKind, MotorState } from "./types.ts";

/** Serial link parameters. 8N1 is the Arduino default and needs no configuring. */
export const SERIAL = {
  baudRate: 9600,
  delimiter: "\n",
  /** The board emits a STATE line at this cadence. */
  telemetryIntervalMs: 1000,
  /** How long the bridge waits for an ACK before retrying (PRD §5). */
  ackTimeoutMs: 2000,
  /** Retries after the first timeout; then the bridge records an alert event. */
  ackRetries: 1,
  /** Delay between serial reconnection attempts (PRD §7.8). */
  reconnectIntervalMs: 5000,
} as const;

export interface Range {
  readonly min: number;
  readonly max: number;
}

/** Accepted ranges for every user-adjustable value (PRD §4). */
export const RANGES = {
  position: { min: 0, max: 100 },
  tempLimit: { min: 18, max: 35 },
  lightLimit: { min: 0, max: 1200 },
  overrideTimeoutMin: { min: 1, max: 60 },
} as const satisfies Record<string, Range>;

/** Firmware defaults, written to EEPROM when the magic byte is absent (FR-1.5). */
export const DEFAULTS = {
  tempLimit: 26,
  lightLimit: 700,
  overrideTimeoutMin: 15,
} as const;

/**
 * Dead band around both thresholds (FR-1.7). Without it the blinds oscillate for
 * minutes whenever a reading sits on the boundary. The mock bridge mirrors these
 * exact values so its behaviour matches the real board.
 */
export const HYSTERESIS = {
  temperatureC: 1.5,
  lightLux: 60,
} as const;

/**
 * When the bridge publishes to /reported (PRD §7.3). The board reports every
 * second; writing every tick burns quota for no user benefit, so a value must
 * move meaningfully or the heartbeat must lapse.
 */
export const PUBLISH = {
  temperatureDeltaC: 0.3,
  lightDeltaLux: 25,
  humidityDeltaPct: 2,
  heartbeatMs: 30_000,
  debounceMs: 500,
} as const;

/** How often the bridge refreshes connection/lastSeen (PRD §7.5). */
export const PRESENCE = {
  heartbeatMs: 20_000,
} as const;

/** The bridge trims /events to this many entries on write (PRD §4 Rules). */
export const EVENTS_MAX = 100;

export function clamp(value: number, range: Range): number {
  return Math.min(range.max, Math.max(range.min, value));
}

export function inRange(value: number, range: Range): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

/** Sensor and actuator readings carried by a STATE line. */
export interface Telemetry {
  /** °C. */
  temperature: number;
  /** Relative humidity, percent. */
  humidity: number;
  /** Lux. */
  light: number;
  /** Percent open, 0–100. */
  position: number;
  mode: BlindMode;
  motorState: MotorState;
  heatProtection: boolean;
  /** Percent, or null when USB-powered (the wire carries -1). */
  battery: number | null;
}

/**
 * An EVENT line. `position` is null on ALERT lines, which report a fault rather
 * than a movement.
 */
export interface SerialEvent {
  kind: EventKind;
  position: number | null;
  message: string;
}

/** A command the bridge can send to the board. */
export type Command =
  | { readonly kind: "position"; readonly value: number }
  | { readonly kind: "mode"; readonly value: BlindMode }
  | { readonly kind: "tempLimit"; readonly value: number }
  | { readonly kind: "lightLimit"; readonly value: number }
  | { readonly kind: "overrideTimeoutMin"; readonly value: number }
  | { readonly kind: "ping" };

/** Anything the board can say. */
export type InboundMessage =
  | { readonly type: "state"; readonly telemetry: Telemetry }
  | { readonly type: "event"; readonly event: SerialEvent }
  | { readonly type: "ready"; readonly firmware: string }
  | { readonly type: "ack"; readonly command: string }
  | { readonly type: "error"; readonly command: string; readonly reason: string }
  | { readonly type: "pong" };

const MODE_FROM_WIRE: Readonly<Record<string, BlindMode>> = {
  AUTO: "auto",
  MANUAL: "manual",
};

const MOTOR_STATE_FROM_WIRE: Readonly<Record<string, MotorState>> = {
  IDLE: "idle",
  MOVING: "moving",
  FAULT: "fault",
};

const EVENT_KIND_FROM_WIRE: Readonly<Record<string, EventKind>> = {
  AUTO: "auto",
  MANUAL: "manual",
  ALERT: "alert",
};

/** Splits `KEY:VALUE` tokens into a lookup. Malformed tokens are skipped. */
function readFields(tokens: readonly string[]): Map<string, string> {
  const fields = new Map<string, string>();
  for (const token of tokens) {
    const separator = token.indexOf(":");
    if (separator > 0) {
      fields.set(token.slice(0, separator), token.slice(separator + 1));
    }
  }
  return fields;
}

/** Reads a field as a finite number, or null when absent or unparseable. */
function readNumber(fields: Map<string, string>, key: string): number | null {
  const raw = fields.get(key);
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// ── Arduino → bridge ──────────────────────────────────────────────────────────

export function formatState(telemetry: Telemetry): string {
  return [
    "STATE",
    `T:${telemetry.temperature.toFixed(1)}`,
    `H:${Math.round(telemetry.humidity)}`,
    `L:${Math.round(telemetry.light)}`,
    `P:${Math.round(telemetry.position)}`,
    `M:${telemetry.mode === "auto" ? "AUTO" : "MANUAL"}`,
    `MS:${telemetry.motorState.toUpperCase()}`,
    `HP:${telemetry.heatProtection ? 1 : 0}`,
    `B:${telemetry.battery === null ? -1 : Math.round(telemetry.battery)}`,
  ].join(" ");
}

export function parseState(line: string): Telemetry | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== "STATE") return null;

  const fields = readFields(tokens.slice(1));
  const temperature = readNumber(fields, "T");
  const humidity = readNumber(fields, "H");
  const light = readNumber(fields, "L");
  const position = readNumber(fields, "P");
  const battery = readNumber(fields, "B");
  const mode = MODE_FROM_WIRE[fields.get("M") ?? ""];
  const motorState = MOTOR_STATE_FROM_WIRE[fields.get("MS") ?? ""];
  const heatProtection = fields.get("HP");

  if (
    temperature === null ||
    humidity === null ||
    light === null ||
    position === null ||
    battery === null ||
    mode === undefined ||
    motorState === undefined ||
    (heatProtection !== "0" && heatProtection !== "1")
  ) {
    return null;
  }

  return {
    temperature,
    humidity,
    light,
    position,
    mode,
    motorState,
    heatProtection: heatProtection === "1",
    battery: battery < 0 ? null : battery,
  };
}

const EVENT_PATTERN = /^EVENT\s+(\S+)(?:\s+P:(-?\d+))?\s+MSG:(.*)$/;

export function formatEvent(event: SerialEvent): string {
  const position = event.position === null ? "" : ` P:${Math.round(event.position)}`;
  return `EVENT ${event.kind.toUpperCase()}${position} MSG:${event.message}`;
}

export function parseEvent(line: string): SerialEvent | null {
  const match = EVENT_PATTERN.exec(line.trim());
  if (match === null) return null;

  const kind = EVENT_KIND_FROM_WIRE[match[1] ?? ""];
  const message = match[3];
  if (kind === undefined || message === undefined) return null;

  const rawPosition = match[2];
  const position = rawPosition === undefined ? null : Number(rawPosition);
  if (position !== null && !Number.isFinite(position)) return null;

  return { kind, position, message: message.trim() };
}

const READY_PATTERN = /^READY\s+FW:(\S+)$/;

export function formatReady(firmware: string): string {
  return `READY FW:${firmware}`;
}

const ACK_PATTERN = /^ACK\s+(.+)$/;
const ERROR_PATTERN = /^ERR\s+(.+?)\s+REASON:(\S+)$/;

export function formatAck(command: string): string {
  return `ACK ${command}`;
}

export function formatError(command: string, reason: string): string {
  return `ERR ${command} REASON:${reason}`;
}

/**
 * Parses any line the board can send. Returns null for anything unrecognised so
 * the caller can log and discard rather than fail (PRD §5, §7.2).
 */
export function parseInbound(line: string): InboundMessage | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;

  if (trimmed === "PONG") return { type: "pong" };

  if (trimmed.startsWith("STATE")) {
    const telemetry = parseState(trimmed);
    return telemetry === null ? null : { type: "state", telemetry };
  }

  if (trimmed.startsWith("EVENT")) {
    const event = parseEvent(trimmed);
    return event === null ? null : { type: "event", event };
  }

  if (trimmed.startsWith("READY")) {
    const match = READY_PATTERN.exec(trimmed);
    const firmware = match?.[1];
    return firmware === undefined ? null : { type: "ready", firmware };
  }

  // ERR is checked before ACK because both begin with a command echo.
  if (trimmed.startsWith("ERR")) {
    const match = ERROR_PATTERN.exec(trimmed);
    const command = match?.[1];
    const reason = match?.[2];
    if (command === undefined || reason === undefined) return null;
    return { type: "error", command, reason };
  }

  if (trimmed.startsWith("ACK")) {
    const match = ACK_PATTERN.exec(trimmed);
    const command = match?.[1];
    return command === undefined ? null : { type: "ack", command: command.trim() };
  }

  return null;
}

// ── Bridge → Arduino ──────────────────────────────────────────────────────────

/**
 * Renders a command for the wire, clamping and rounding as it goes. This is the
 * last line of defence against a bad number from the network reaching the board,
 * so it must never be bypassed by writing a raw string to the serial port.
 */
export function formatCommand(command: Command): string {
  switch (command.kind) {
    case "position":
      return `SET P:${Math.round(clamp(command.value, RANGES.position))}`;
    case "mode":
      return `SET MODE:${command.value === "auto" ? "AUTO" : "MANUAL"}`;
    case "tempLimit":
      return `SET TLIM:${Math.round(clamp(command.value, RANGES.tempLimit))}`;
    case "lightLimit":
      return `SET LLIM:${Math.round(clamp(command.value, RANGES.lightLimit))}`;
    case "overrideTimeoutMin":
      return `SET TIMEOUT:${Math.round(clamp(command.value, RANGES.overrideTimeoutMin))}`;
    case "ping":
      return "PING";
  }
}

/**
 * Parses a command line. Used by the mock bridge to emulate the board, and by
 * the protocol tests; the real firmware implements this in C.
 */
export function parseCommand(line: string): Command | null {
  const trimmed = line.trim();
  if (trimmed === "PING") return { kind: "ping" };

  const tokens = trimmed.split(/\s+/);
  if (tokens[0] !== "SET" || tokens.length !== 2) return null;

  const fields = readFields(tokens.slice(1));

  const mode = MODE_FROM_WIRE[fields.get("MODE") ?? ""];
  if (mode !== undefined) return { kind: "mode", value: mode };

  const position = readNumber(fields, "P");
  if (position !== null) {
    return inRange(position, RANGES.position) ? { kind: "position", value: position } : null;
  }

  const tempLimit = readNumber(fields, "TLIM");
  if (tempLimit !== null) {
    return inRange(tempLimit, RANGES.tempLimit) ? { kind: "tempLimit", value: tempLimit } : null;
  }

  const lightLimit = readNumber(fields, "LLIM");
  if (lightLimit !== null) {
    return inRange(lightLimit, RANGES.lightLimit) ? { kind: "lightLimit", value: lightLimit } : null;
  }

  const timeout = readNumber(fields, "TIMEOUT");
  if (timeout !== null) {
    return inRange(timeout, RANGES.overrideTimeoutMin)
      ? { kind: "overrideTimeoutMin", value: timeout }
      : null;
  }

  return null;
}
