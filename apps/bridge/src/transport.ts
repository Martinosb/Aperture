/**
 * A newline-delimited link to the board.
 *
 * Both the real serial port and the mock board implement this, so everything
 * above it — protocol parsing, ACK tracking, Firebase mirroring — runs
 * identically whether or not hardware is attached. Swapping `--mock` for a real
 * cable changes this one object and nothing else.
 */
export interface LineTransport {
  /** Human-readable source, e.g. "/dev/ttyUSB0" or "mock". */
  readonly name: string;
  open(): Promise<void>;
  close(): Promise<void>;
  /** Sends one line. The newline terminator is added by the transport. */
  write(line: string): void;
  onLine(handler: (line: string) => void): void;
  /** Fired when the link drops. `reason` is null for a clean close. */
  onClose(handler: (reason: Error | null) => void): void;
}
