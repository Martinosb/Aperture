import { resolve } from "node:path";

import { DEFAULT_DEVICE_ID, SERIAL } from "@aperture/shared";
import { config as loadEnvFile } from "dotenv";
import { z } from "zod";

// dotenv does not overwrite variables that are already set, so the first file
// that defines a key wins: the bridge's own .env, then the workspace root's.
loadEnvFile({ path: resolve(process.cwd(), ".env"), quiet: true });
loadEnvFile({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const EnvSchema = z.object({
  DEVICE_ID: z.string().min(1).default(DEFAULT_DEVICE_ID),
  FIREBASE_DATABASE_URL: z.string().min(1),
  FIREBASE_PROJECT_ID: z.string().min(1).default("aperture-local"),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().min(1).optional(),
  /**
   * Set by the Firebase emulator (host:port). When present the admin SDK talks
   * to the local emulator and needs no service-account credential.
   */
  FIREBASE_DATABASE_EMULATOR_HOST: z.string().min(1).optional(),
  SERIAL_PORT: z.string().min(1).optional(),
  SERIAL_BAUD: z.coerce.number().int().positive().default(SERIAL.baudRate),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type Config = z.infer<typeof EnvSchema> & {
  readonly usingEmulator: boolean;
};

/**
 * Reads and validates the environment. Throws with a readable message rather
 * than letting a missing variable surface as an obscure failure later.
 */
export function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment. Copy .env.example to .env and fill it in.\n${problems}`,
    );
  }

  const env = parsed.data;
  const usingEmulator = env.FIREBASE_DATABASE_EMULATOR_HOST !== undefined;

  if (!usingEmulator && env.FIREBASE_SERVICE_ACCOUNT_PATH === undefined) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_PATH is required when not using the emulator. " +
        "Set FIREBASE_DATABASE_EMULATOR_HOST to run against a local emulator instead.",
    );
  }

  return { ...env, usingEmulator };
}
