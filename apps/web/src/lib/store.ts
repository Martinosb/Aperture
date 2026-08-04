import type {
  ConnectionState,
  DesiredPatch,
  DesiredState,
  DeviceEvent,
  DeviceMeta,
  ReportedState,
} from "@aperture/shared";
import { create } from "zustand";

/**
 * Client state, fed by the Firebase subscription.
 *
 * The three connection layers are tracked separately and never conflated,
 * because the fix differs for each (PRD §8): the phone being offline is a
 * different sentence from the window unit being offline.
 */

export interface StoredEvent extends DeviceEvent {
  id: string;
}

/** How long to wait for the hardware to catch up before admitting it hasn't. */
export const ADJUST_TIMEOUT_MS = 5000;

/** A reading older than this means the bridge has stopped hearing the board. */
export const TELEMETRY_STALE_MS = 15_000;

export interface DeviceStore {
  meta: DeviceMeta | null;
  reported: ReportedState | null;
  desired: DesiredState | null;
  connection: ConnectionState | null;
  events: StoredEvent[];

  /** Layer 1: this browser's own link to Firebase. */
  browserOnline: boolean;
  /** True once the first snapshot has arrived, so loading is distinct from empty. */
  ready: boolean;

  /** What we last asked for and are still waiting on. */
  pending: DesiredPatch | null;
  pendingSince: number | null;
  /** Set when the unit did not respond in time. */
  unresponsive: boolean;
  /** Set when a Firebase listener rejected, e.g. on a rules failure. */
  listenerError: string | null;

  setMeta: (meta: DeviceMeta | null) => void;
  setReported: (reported: ReportedState | null) => void;
  setDesiredState: (desired: DesiredState | null) => void;
  setConnection: (connection: ConnectionState | null) => void;
  setEvents: (events: StoredEvent[]) => void;
  setBrowserOnline: (online: boolean) => void;
  setReady: (ready: boolean) => void;
  beginPending: (patch: DesiredPatch) => void;
  clearPending: () => void;
  setUnresponsive: (value: boolean) => void;
  setListenerError: (message: string | null) => void;
}

export const useDeviceStore = create<DeviceStore>((set) => ({
  meta: null,
  reported: null,
  desired: null,
  connection: null,
  events: [],
  browserOnline: true,
  ready: false,
  pending: null,
  pendingSince: null,
  unresponsive: false,
  listenerError: null,

  setMeta: (meta) => set({ meta }),
  setReported: (reported) => set({ reported }),
  setDesiredState: (desired) => set({ desired }),
  setConnection: (connection) => set({ connection }),
  setEvents: (events) => set({ events }),
  setBrowserOnline: (browserOnline) => set({ browserOnline }),
  setReady: (ready) => set({ ready }),

  beginPending: (patch) =>
    set((state) => ({
      pending: { ...state.pending, ...patch },
      pendingSince: Date.now(),
      unresponsive: false,
    })),

  clearPending: () => set({ pending: null, pendingSince: null }),
  setUnresponsive: (unresponsive) => set({ unresponsive }),
  setListenerError: (listenerError) => set({ listenerError }),
}));
