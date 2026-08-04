import { DEFAULT_DEVICE_ID } from "@aperture/shared";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";

/**
 * Firebase wiring for the browser.
 *
 * The security rules require an authenticated caller, and PRD §16 limits the
 * product to a single shared identity, so the app signs in anonymously rather
 * than putting a login screen in front of a device dashboard.
 */

export const DEVICE_ID = process.env.NEXT_PUBLIC_DEVICE_ID ?? DEFAULT_DEVICE_ID;

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

const databaseEmulator = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_EMULATOR_HOST;
const authEmulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;

let cached: { app: FirebaseApp; db: Database; auth: Auth } | null = null;

/** True when the app has enough configuration to reach a database at all. */
export function isConfigured(): boolean {
  return config.databaseURL !== "";
}

export function getFirebase(): { app: FirebaseApp; db: Database; auth: Auth } {
  if (cached !== null) return cached;

  const app = getApps().length === 0 ? initializeApp(config) : getApp();
  const db = getDatabase(app);
  const auth = getAuth(app);

  if (databaseEmulator !== undefined && databaseEmulator !== "") {
    const [host, port] = databaseEmulator.split(":");
    connectDatabaseEmulator(db, host ?? "127.0.0.1", Number(port ?? 9000));
  }
  if (authEmulator !== undefined && authEmulator !== "") {
    connectAuthEmulator(auth, authEmulator, { disableWarnings: true });
  }

  cached = { app, db, auth };
  return cached;
}

let signInPromise: Promise<void> | null = null;

/** Signs in once per page load; concurrent callers share the same attempt. */
export function ensureSignedIn(): Promise<void> {
  if (signInPromise !== null) return signInPromise;

  const { auth } = getFirebase();
  signInPromise = auth.currentUser !== null
    ? Promise.resolve()
    : signInAnonymously(auth).then(() => undefined);

  return signInPromise;
}
