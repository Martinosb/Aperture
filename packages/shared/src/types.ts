/**
 * Firebase Realtime Database schema (PRD §4).
 *
 * These shapes are a contract between two separately-running processes. They are
 * declared here once and imported by both apps — never redeclared locally.
 *
 * Ownership of each subtree is strict and enforced by the security rules:
 *   desired    — written only by the PWA, read by the bridge
 *   reported   — written only by the bridge, read by the PWA
 *   connection — written only by the bridge (plus Firebase's own onDisconnect)
 *   events     — written only by the bridge, append-only, capped at EVENTS_MAX
 */

/** Automation mode. `auto` lets the firmware decide; `manual` pauses it. */
export type BlindMode = "auto" | "manual";

/** What the stepper is doing right now. */
export type MotorState = "idle" | "moving" | "fault";

/** Why an event was recorded. */
export type EventKind = "auto" | "manual" | "alert";

export interface DeviceMeta {
  name: string;
  firmware: string;
  createdAt: number;
}

/** What the user wants. Only the PWA writes this. */
export interface DesiredState {
  /** Percent open, 0–100. */
  position: number;
  mode: BlindMode;
  /** Close-above threshold in °C, 18–35. */
  tempLimit: number;
  /** Sunlight trigger in lux, 0–1200. */
  lightLimit: number;
  /** Minutes of manual override before automation resumes, 1–60. */
  overrideTimeoutMin: number;
  updatedAt: number;
}

/**
 * A partial update to `desired`. Every PWA mutation goes through this shape;
 * `updatedAt` is stamped by the write helper, never by the caller.
 */
export type DesiredPatch = Partial<Omit<DesiredState, "updatedAt">>;

/** What the hardware actually is. Only the bridge writes this. */
export interface ReportedState {
  position: number;
  mode: BlindMode;
  tempLimit: number;
  lightLimit: number;
  /** °C. */
  temperature: number;
  /** Relative humidity, percent. */
  humidity: number;
  /** Lux. */
  light: number;
  motorState: MotorState;
  /** True when the blinds are shut specifically because of heat plus sun. */
  heatProtection: boolean;
  /** Epoch ms when manual override lapses, or null while in auto. */
  overrideEndsAt: number | null;
  /** Battery percent, or null when USB-powered. */
  battery: number | null;
  updatedAt: number;
}

/**
 * Bridge presence. `online` is flipped to false by Firebase itself via
 * onDisconnect() when the bridge dies or loses network — never by a client-side
 * timeout (PRD §4 Rules).
 */
export interface ConnectionState {
  online: boolean;
  lastSeen: number;
  serialPort: string | null;
  bridgeVersion: string;
}

export interface DeviceEvent {
  at: number;
  kind: EventKind;
  position: number;
  message: string;
}

/** Events keyed by RTDB push id. */
export type DeviceEvents = Record<string, DeviceEvent>;

export interface DeviceSnapshot {
  meta: DeviceMeta;
  desired: DesiredState;
  reported: ReportedState;
  connection: ConnectionState;
  events: DeviceEvents;
}
