import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EVENTS_MAX,
  PRESENCE,
  PUBLISH,
  connectionPath,
  desiredPath,
  eventsPath,
  metaPath,
  reportedPath,
  type DesiredState,
  type DeviceEvent,
  type EventKind,
  type ReportedState,
} from "@aperture/shared";
import { cert, deleteApp, initializeApp, type App } from "firebase-admin/app";
import { ServerValue, getDatabase, type Database } from "firebase-admin/database";
import type { Logger } from "pino";

import type { Config } from "./config.ts";

/**
 * Everything the bridge does against the Realtime Database (PRD §7.3–§7.6).
 *
 * Ownership is one-directional and strict: this process writes `reported`,
 * `connection` and `events`, and only ever reads `desired`.
 */
export class DeviceSync {
  readonly #db: Database;
  readonly #app: App;
  readonly #deviceId: string;
  readonly #logger: Logger;
  readonly #bridgeVersion: string;

  #lastPublished: ReportedState | null = null;
  #lastWriteAt = 0;
  #debounce: NodeJS.Timeout | null = null;
  #queued: ReportedState | null = null;
  #presenceTimer: NodeJS.Timeout | null = null;
  #eventCount = 0;
  #serialPort: string | null = null;

  constructor(config: Config, logger: Logger, bridgeVersion: string) {
    this.#deviceId = config.DEVICE_ID;
    this.#logger = logger;
    this.#bridgeVersion = bridgeVersion;

    if (config.usingEmulator) {
      // The emulator needs no credential; the admin SDK picks up
      // FIREBASE_DATABASE_EMULATOR_HOST from the environment.
      this.#app = initializeApp({
        projectId: config.FIREBASE_PROJECT_ID,
        databaseURL: config.FIREBASE_DATABASE_URL,
      });
      logger.info(
        { host: config.FIREBASE_DATABASE_EMULATOR_HOST },
        "using the Realtime Database emulator",
      );
    } else {
      const path = resolve(process.cwd(), config.FIREBASE_SERVICE_ACCOUNT_PATH ?? "");
      const serviceAccount: unknown = JSON.parse(readFileSync(path, "utf8"));
      this.#app = initializeApp({
        credential: cert(serviceAccount as Parameters<typeof cert>[0]),
        databaseURL: config.FIREBASE_DATABASE_URL,
      });
    }

    this.#db = getDatabase(this.#app);
  }

  async close(): Promise<void> {
    if (this.#presenceTimer !== null) clearInterval(this.#presenceTimer);
    if (this.#debounce !== null) clearTimeout(this.#debounce);
    await this.#db.ref(connectionPath(this.#deviceId)).update({
      online: false,
      lastSeen: ServerValue.TIMESTAMP,
    });
    await deleteApp(this.#app);
  }

  /**
   * Presence (PRD §7.5). onDisconnect is registered *by the server*, so if this
   * process is killed or the network drops, Firebase itself flips `online` to
   * false. Never try to infer this from a client-side timeout.
   *
   * The registration is renewed every time the SDK reconnects, because a
   * disconnect consumes the previously registered handler.
   */
  startPresence(serialPort: string | null): void {
    this.#serialPort = serialPort;
    const ref = this.#db.ref(connectionPath(this.#deviceId));

    this.#db.ref(".info/connected").on("value", (snapshot) => {
      if (snapshot.val() !== true) {
        this.#logger.warn("lost the connection to Firebase");
        return;
      }

      ref
        .onDisconnect()
        .update({ online: false, lastSeen: ServerValue.TIMESTAMP })
        .then(() =>
          ref.set({
            online: true,
            lastSeen: ServerValue.TIMESTAMP,
            serialPort: this.#serialPort,
            bridgeVersion: this.#bridgeVersion,
          }),
        )
        .catch((error: unknown) => this.#logger.error({ err: error }, "presence write failed"));
    });

    this.#presenceTimer = setInterval(() => {
      ref
        .update({ lastSeen: ServerValue.TIMESTAMP })
        .catch((error: unknown) => this.#logger.debug({ err: error }, "heartbeat failed"));
    }, PRESENCE.heartbeatMs);
  }

  /** Updates the reported serial port after a reconnection. */
  setSerialPort(serialPort: string | null): void {
    this.#serialPort = serialPort;
    this.#db
      .ref(connectionPath(this.#deviceId))
      .update({ serialPort })
      .catch((error: unknown) => this.#logger.debug({ err: error }, "port update failed"));
  }

  async ensureMeta(firmware: string): Promise<void> {
    const ref = this.#db.ref(metaPath(this.#deviceId));
    const snapshot = await ref.once("value");
    if (snapshot.exists()) {
      await ref.update({ firmware });
      return;
    }
    await ref.set({ name: "Bedroom window", firmware, createdAt: ServerValue.TIMESTAMP });
  }

  async readDesired(): Promise<DesiredState | null> {
    const snapshot = await this.#db.ref(desiredPath(this.#deviceId)).once("value");
    return snapshot.exists() ? (snapshot.val() as DesiredState) : null;
  }

  /**
   * Bootstraps `/desired` on a database that has never seen this device, using
   * what the board actually reports. Starting from the hardware's own state
   * means nothing moves unexpectedly the first time the app connects. After
   * this, only the PWA writes here.
   */
  async seedDesiredIfAbsent(from: ReportedState): Promise<boolean> {
    const ref = this.#db.ref(desiredPath(this.#deviceId));
    const snapshot = await ref.once("value");
    if (snapshot.exists()) return false;

    const seed: Omit<DesiredState, "updatedAt"> = {
      position: from.position,
      mode: from.mode,
      tempLimit: from.tempLimit,
      lightLimit: from.lightLimit,
      overrideTimeoutMin: 15,
    };
    await ref.set({ ...seed, updatedAt: ServerValue.TIMESTAMP });
    this.#logger.info(seed, "seeded /desired from the board's own state");
    return true;
  }

  /** Watches `/desired`, skipping the echo of our own seed write. */
  onDesired(handler: (desired: DesiredState) => void): void {
    this.#db.ref(desiredPath(this.#deviceId)).on("value", (snapshot) => {
      if (!snapshot.exists()) return;
      handler(snapshot.val() as DesiredState);
    });
  }

  /**
   * Queues a reading for publication, debounced so a burst of changes becomes
   * one write (PRD §7.3).
   */
  publish(state: ReportedState): void {
    this.#queued = state;
    if (this.#debounce !== null) return;

    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      const queued = this.#queued;
      this.#queued = null;
      if (queued !== null) void this.#write(queued);
    }, PUBLISH.debounceMs);
  }

  get lastPublished(): ReportedState | null {
    return this.#lastPublished;
  }

  get msSinceLastWrite(): number {
    return this.#lastWriteAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - this.#lastWriteAt;
  }

  async #write(state: ReportedState): Promise<void> {
    try {
      await this.#db
        .ref(reportedPath(this.#deviceId))
        .set({ ...state, updatedAt: ServerValue.TIMESTAMP });
      this.#lastPublished = state;
      this.#lastWriteAt = Date.now();
    } catch (error) {
      this.#logger.error({ err: error }, "failed to write /reported");
    }
  }

  async pushEvent(kind: EventKind, position: number, message: string): Promise<void> {
    const entry: Omit<DeviceEvent, "at"> = { kind, position, message };
    try {
      await this.#db
        .ref(eventsPath(this.#deviceId))
        .push({ ...entry, at: ServerValue.TIMESTAMP });
      this.#eventCount += 1;
      await this.#trimEvents();
    } catch (error) {
      this.#logger.error({ err: error }, "failed to push an event");
    }
  }

  /** Keeps `/events` at the newest EVENTS_MAX entries (PRD §4 Rules). */
  async #trimEvents(): Promise<void> {
    if (this.#eventCount <= EVENTS_MAX) return;

    const excess = this.#eventCount - EVENTS_MAX;
    const ref = this.#db.ref(eventsPath(this.#deviceId));
    const oldest = await ref.orderByKey().limitToFirst(excess).once("value");

    const removals: Promise<void>[] = [];
    oldest.forEach((child) => {
      if (child.key !== null) removals.push(ref.child(child.key).remove());
    });
    await Promise.all(removals);
    this.#eventCount = EVENTS_MAX;
  }

  /** Counts existing events once at startup so trimming starts from the truth. */
  async primeEventCount(): Promise<void> {
    const snapshot = await this.#db.ref(eventsPath(this.#deviceId)).once("value");
    this.#eventCount = snapshot.numChildren();
  }
}
