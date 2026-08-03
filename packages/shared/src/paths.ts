/**
 * Realtime Database path helpers (PRD §4).
 *
 * Paths are built here and nowhere else, so a typo cannot silently write to a
 * subtree the security rules would otherwise have protected. Paths are relative
 * to the database root with no leading slash, which is what both the web SDK's
 * `ref(db, path)` and firebase-admin's `db.ref(path)` expect.
 */

/** Used when DEVICE_ID is absent from the environment. */
export const DEFAULT_DEVICE_ID = "window-01";

export const DEVICES_ROOT = "devices";

export function devicePath(deviceId: string): string {
  return `${DEVICES_ROOT}/${deviceId}`;
}

export function metaPath(deviceId: string): string {
  return `${devicePath(deviceId)}/meta`;
}

/** Written only by the PWA. */
export function desiredPath(deviceId: string): string {
  return `${devicePath(deviceId)}/desired`;
}

/** Written only by the bridge. */
export function reportedPath(deviceId: string): string {
  return `${devicePath(deviceId)}/reported`;
}

/** Written by the bridge, and by Firebase itself via onDisconnect(). */
export function connectionPath(deviceId: string): string {
  return `${devicePath(deviceId)}/connection`;
}

/** Append-only, capped at EVENTS_MAX by the bridge. */
export function eventsPath(deviceId: string): string {
  return `${devicePath(deviceId)}/events`;
}
