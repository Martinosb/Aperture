import { PUBLISH, type ReportedState } from "@aperture/shared";

/**
 * Deciding when a reading is worth a Firebase write (PRD §7.3).
 *
 * The board reports every second. Writing every tick would burn quota and
 * bandwidth to tell the user nothing, so a value has to move meaningfully — or
 * the heartbeat has to lapse — before anything is published.
 */

/** Fields where any change at all matters to the user. */
const DISCRETE_FIELDS = [
  "position",
  "mode",
  "motorState",
  "heatProtection",
  "tempLimit",
  "lightLimit",
  "overrideEndsAt",
] as const satisfies readonly (keyof ReportedState)[];

export function hasMeaningfulChange(
  previous: ReportedState | null,
  next: ReportedState,
): boolean {
  if (previous === null) return true;

  for (const field of DISCRETE_FIELDS) {
    if (previous[field] !== next[field]) return true;
  }

  if (Math.abs(next.temperature - previous.temperature) >= PUBLISH.temperatureDeltaC) return true;
  if (Math.abs(next.light - previous.light) >= PUBLISH.lightDeltaLux) return true;
  if (Math.abs(next.humidity - previous.humidity) >= PUBLISH.humidityDeltaPct) return true;

  const previousBattery = previous.battery ?? -1;
  const nextBattery = next.battery ?? -1;
  if (Math.abs(nextBattery - previousBattery) >= 1) return true;

  return false;
}

/**
 * True when the reading should reach Firebase: either something moved, or the
 * heartbeat interval has elapsed and the PWA deserves proof of life.
 */
export function shouldPublish(
  previous: ReportedState | null,
  next: ReportedState,
  msSinceLastWrite: number,
): boolean {
  if (hasMeaningfulChange(previous, next)) return true;
  return msSinceLastWrite >= PUBLISH.heartbeatMs;
}
