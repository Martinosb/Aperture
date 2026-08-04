import type { ReportedState } from "@aperture/shared";

/**
 * The compact live line an operator can read at a glance (PRD §7 CLI output):
 *
 *   [14:02:31] ● connected  /dev/ttyUSB0   T 28.4°C  H 64%  L 850lx  P 62%  AUTO  idle
 */
export function renderStatusLine(
  state: ReportedState | null,
  portName: string | null,
  connected: boolean,
  at: Date = new Date(),
): string {
  const clock = at.toTimeString().slice(0, 8);
  const link = connected ? "● connected" : "○ waiting";
  const port = portName ?? "no port";

  if (state === null) {
    return `[${clock}] ${link}  ${port}   no telemetry yet`;
  }

  return [
    `[${clock}]`,
    link,
    ` ${port}  `,
    ` T ${state.temperature.toFixed(1)}°C`,
    ` H ${Math.round(state.humidity)}%`,
    ` L ${Math.round(state.light)}lx`,
    ` P ${Math.round(state.position)}%`,
    ` ${state.mode.toUpperCase()}`,
    ` ${state.motorState}`,
  ].join(" ");
}

/** Carriage return plus "erase to end of line", so the line redraws in place. */
const CLEAR_LINE = "\r\u001b[2K";

/**
 * Redraws the status line in place on a terminal. When output is piped the line
 * is skipped entirely — the structured logs already carry everything.
 */
export function writeStatusLine(line: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${CLEAR_LINE}${line}`);
}
