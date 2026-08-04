import type { Command, DesiredState, ReportedState, Telemetry } from "@aperture/shared";

/**
 * Reconciling the two halves of the shadow.
 *
 * A STATE line carries sensor readings and motor state but not the thresholds —
 * the board has them in EEPROM and never echoes them back. The bridge knows them
 * because it is the only thing that ever sets them, so it supplies them here
 * rather than inventing a protocol field for something it already knows.
 */

export interface KnownLimits {
  tempLimit: number;
  lightLimit: number;
  overrideTimeoutMin: number;
}

/**
 * Builds the reported state the PWA renders.
 *
 * `overrideEndsAt` is derived: the firmware owns the countdown, but it reports
 * only the mode, so the bridge stamps the deadline when it first sees MANUAL and
 * clears it the moment the board returns to AUTO.
 */
export function composeReported(
  telemetry: Telemetry,
  limits: KnownLimits,
  previous: ReportedState | null,
  now: number,
): ReportedState {
  const wasManual = previous?.mode === "manual";
  const isManual = telemetry.mode === "manual";

  let overrideEndsAt: number | null = null;
  if (isManual) {
    overrideEndsAt =
      wasManual && previous?.overrideEndsAt != null
        ? previous.overrideEndsAt
        : now + limits.overrideTimeoutMin * 60_000;
  }

  return {
    position: telemetry.position,
    mode: telemetry.mode,
    tempLimit: limits.tempLimit,
    lightLimit: limits.lightLimit,
    temperature: telemetry.temperature,
    humidity: telemetry.humidity,
    light: telemetry.light,
    motorState: telemetry.motorState,
    heatProtection: telemetry.heatProtection,
    overrideEndsAt,
    battery: telemetry.battery,
    updatedAt: now,
  };
}

/**
 * Translates a change in `/desired` into the smallest set of commands (PRD §7.4).
 *
 * Two rules shape this:
 *
 * 1. Order matters. Thresholds first, then position, then mode. `SET P` implies
 *    MANUAL on the board, so an explicit mode change has to come last or it
 *    would be immediately undone.
 *
 * 2. On a full re-push — bridge startup or a board reset — the comparison is
 *    against what the board *actually reports*, not against nothing. Sending
 *    `SET P` for a position the board is already at would knock it out of AUTO
 *    into a manual override nobody asked for, and log a phantom event.
 */
export function diffDesired(
  previous: DesiredState | null,
  next: DesiredState,
  actual: ReportedState | null,
): Command[] {
  const commands: Command[] = [];

  // On an incremental change, the user's intent moved. On a full re-push, only
  // send what the hardware does not already agree with.
  const differs = <K extends keyof DesiredState>(
    field: K,
    actualValue: DesiredState[K] | undefined,
  ): boolean => {
    if (previous !== null) return previous[field] !== next[field];
    return actualValue === undefined || actualValue !== next[field];
  };

  if (differs("tempLimit", actual?.tempLimit)) {
    commands.push({ kind: "tempLimit", value: next.tempLimit });
  }
  if (differs("lightLimit", actual?.lightLimit)) {
    commands.push({ kind: "lightLimit", value: next.lightLimit });
  }
  // The board never echoes its override timeout, so a full re-push always
  // restates it. It is a threshold, not a movement — restating is harmless.
  if (previous === null || previous.overrideTimeoutMin !== next.overrideTimeoutMin) {
    commands.push({ kind: "overrideTimeoutMin", value: next.overrideTimeoutMin });
  }
  if (differs("position", actual === null ? undefined : Math.round(actual.position))) {
    commands.push({ kind: "position", value: next.position });
  }
  if (differs("mode", actual?.mode)) {
    commands.push({ kind: "mode", value: next.mode });
  }

  return commands;
}
