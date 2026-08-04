"use client";

import {
  EVENTS_MAX,
  connectionPath,
  desiredPath,
  eventsPath,
  metaPath,
  reportedPath,
  type ConnectionState,
  type DesiredPatch,
  type DesiredState,
  type DeviceEvent,
  type DeviceMeta,
  type ReportedState,
} from "@aperture/shared";
import {
  limitToLast,
  onValue,
  query,
  ref,
  serverTimestamp,
  update,
} from "firebase/database";
import { useEffect, useState } from "react";

import { DEVICE_ID, ensureSignedIn, getFirebase, isConfigured } from "./client";
import {
  ADJUST_TIMEOUT_MS,
  TELEMETRY_STALE_MS,
  useDeviceStore,
  type StoredEvent,
} from "../store";

/**
 * The one place the app talks to Firebase.
 *
 * Every mutation goes through `setDesired`; no component writes to the database
 * directly. Reads flow into the zustand store so that a single set of listeners
 * serves the whole tree.
 */

/** Opens all listeners. Returns a teardown for React strict-mode remounts. */
export function startDeviceSubscription(): () => void {
  if (!isConfigured()) {
    useDeviceStore.getState().setReady(true);
    return () => undefined;
  }

  const store = useDeviceStore.getState();
  const { db } = getFirebase();
  const unsubscribers: (() => void)[] = [];

  // A listener that dies quietly leaves the dashboard looking merely empty,
  // which is indistinguishable from "no device yet". Say so instead.
  const onListenerError = (path: string) => (error: Error) => {
    console.error(`[aperture] listener failed on ${path}:`, error.message);
    store.setListenerError(error.message);
    store.setReady(true);
  };

  void ensureSignedIn().catch((error: unknown) => {
    console.error("[aperture] sign-in failed:", error);
    // Rules require auth; without it the listeners below stay empty and the UI
    // falls back to its "no device" state rather than hanging on a spinner.
    store.setReady(true);
  });

  // Layer 1 — this browser's link to Firebase. The SDK reports it directly.
  unsubscribers.push(
    onValue(ref(db, ".info/connected"), (snapshot) => {
      store.setBrowserOnline(snapshot.val() === true);
    }, onListenerError(".info/connected")),
  );

  unsubscribers.push(
    onValue(ref(db, reportedPath(DEVICE_ID)), (snapshot) => {
      store.setReported(snapshot.exists() ? (snapshot.val() as ReportedState) : null);
      store.setReady(true);
    }, onListenerError("reported")),
  );

  unsubscribers.push(
    onValue(ref(db, desiredPath(DEVICE_ID)), (snapshot) => {
      store.setDesiredState(snapshot.exists() ? (snapshot.val() as DesiredState) : null);
    }, onListenerError("desired")),
  );

  // Layer 2 — the bridge's link to Firebase, maintained server-side by
  // onDisconnect() so it stays truthful even when the bridge dies abruptly.
  unsubscribers.push(
    onValue(ref(db, connectionPath(DEVICE_ID)), (snapshot) => {
      store.setConnection(snapshot.exists() ? (snapshot.val() as ConnectionState) : null);
    }, onListenerError("connection")),
  );

  unsubscribers.push(
    onValue(ref(db, metaPath(DEVICE_ID)), (snapshot) => {
      store.setMeta(snapshot.exists() ? (snapshot.val() as DeviceMeta) : null);
    }, onListenerError("meta")),
  );

  unsubscribers.push(
    onValue(query(ref(db, eventsPath(DEVICE_ID)), limitToLast(EVENTS_MAX)), (snapshot) => {
      const events: StoredEvent[] = [];
      snapshot.forEach((child) => {
        if (child.key !== null) {
          events.push({ id: child.key, ...(child.val() as DeviceEvent) });
        }
      });
      events.reverse(); // newest first
      store.setEvents(events);
    }, onListenerError("events")),
  );

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

/**
 * Shallow-merges intent into `/desired` and stamps the write server-side.
 *
 * The caller is told what was asked for, not what happened — the UI learns the
 * outcome by watching `/reported` come back.
 */
export async function setDesired(patch: DesiredPatch): Promise<void> {
  const store = useDeviceStore.getState();
  store.beginPending(patch);

  if (!isConfigured()) return;

  const { db } = getFirebase();
  await ensureSignedIn();
  await update(ref(db, desiredPath(DEVICE_ID)), { ...patch, updatedAt: serverTimestamp() });
}

/** A clock that ticks so relative timestamps and staleness stay honest. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export type ThermalState = "heat-gain" | "comfortable";

export interface DeviceView {
  meta: DeviceMeta | null;
  reported: ReportedState | null;
  desired: DesiredState | null;
  connection: ConnectionState | null;
  ready: boolean;

  /** Layer 1 — is this phone reaching Firebase? */
  browserOnline: boolean;
  /** Layer 2 — is the bridge reaching Firebase? */
  deviceOnline: boolean;
  /** Layer 3 — is the bridge still hearing the board? */
  telemetryFresh: boolean;

  /** Controls are usable only when every layer is up. */
  controlsEnabled: boolean;
  /** True while a requested change has not yet shown up in `/reported`. */
  adjusting: boolean;
  unresponsive: boolean;
  /** The value the user asked for, while we wait for the hardware to agree. */
  pendingPosition: number | null;

  thermal: ThermalState;
  /** Position the dial should display: the request if pending, else the truth. */
  displayPosition: number;
}

/**
 * Subscribes to reported and connection state and returns a typed view of the
 * device, with the three connection layers kept distinct.
 */
export function useDevice(): DeviceView {
  const meta = useDeviceStore((state) => state.meta);
  const reported = useDeviceStore((state) => state.reported);
  const desired = useDeviceStore((state) => state.desired);
  const connection = useDeviceStore((state) => state.connection);
  const browserOnline = useDeviceStore((state) => state.browserOnline);
  const ready = useDeviceStore((state) => state.ready);
  const pending = useDeviceStore((state) => state.pending);
  const unresponsive = useDeviceStore((state) => state.unresponsive);

  const now = useNow(1000);

  const deviceOnline = connection?.online === true;
  const telemetryFresh =
    reported !== null && now - reported.updatedAt < TELEMETRY_STALE_MS;

  const pendingPosition = pending?.position ?? null;
  const adjusting =
    pending !== null &&
    (pendingPosition === null ||
      reported === null ||
      Math.round(reported.position) !== Math.round(pendingPosition) ||
      reported.motorState === "moving");

  const thermal: ThermalState =
    reported !== null && reported.heatProtection ? "heat-gain" : "comfortable";

  const displayPosition =
    adjusting && pendingPosition !== null ? pendingPosition : (reported?.position ?? 0);

  return {
    meta,
    reported,
    desired,
    connection,
    ready,
    browserOnline,
    deviceOnline,
    telemetryFresh,
    controlsEnabled: browserOnline && deviceOnline,
    adjusting,
    unresponsive,
    pendingPosition,
    thermal,
    displayPosition,
  };
}

/**
 * Clears the pending state once the hardware agrees, or gives up after
 * ADJUST_TIMEOUT_MS and says so plainly rather than leaving a spinner running.
 */
export function useAdjustmentWatchdog(onTimeout: () => void): void {
  const pending = useDeviceStore((state) => state.pending);
  const pendingSince = useDeviceStore((state) => state.pendingSince);
  const reported = useDeviceStore((state) => state.reported);

  useEffect(() => {
    if (pending === null || pendingSince === null) return;

    const target = pending.position;
    const settled =
      reported !== null &&
      (target === undefined || Math.round(reported.position) === Math.round(target)) &&
      reported.motorState !== "moving";

    if (settled) {
      useDeviceStore.getState().clearPending();
      return;
    }

    const remaining = ADJUST_TIMEOUT_MS - (Date.now() - pendingSince);
    const timer = setTimeout(
      () => {
        useDeviceStore.getState().clearPending();
        useDeviceStore.getState().setUnresponsive(true);
        onTimeout();
      },
      Math.max(0, remaining),
    );

    return () => clearTimeout(timer);
  }, [pending, pendingSince, reported, onTimeout]);
}

/** The newest `limit` events, newest first. */
export function useEvents(limit = 50): StoredEvent[] {
  const events = useDeviceStore((state) => state.events);
  return events.slice(0, limit);
}
