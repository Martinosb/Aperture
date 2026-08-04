import { pino, type Logger } from "pino";

/**
 * Pretty output when attached to a terminal, plain JSON when piped so the logs
 * stay machine-readable under a process supervisor.
 */
export function createLogger(level: string): Logger {
  if (process.stdout.isTTY) {
    return pino({
      level,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
    });
  }
  return pino({ level });
}
