"use client";

/**
 * First run, or a database with no device in it yet (PRD §12).
 *
 * The fix is always the same — start the bridge — so the screen says exactly
 * that and gives the command to run rather than a generic empty illustration.
 */
export function FirstRun({ online }: { online: boolean }): React.JSX.Element {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 pb-32 text-center">
      <div
        className="flex h-[62px] w-[74px] flex-col justify-between rounded-lg p-[7px]"
        style={{ border: "2px solid var(--color-tile-sunk)" }}
        aria-hidden="true"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[2px]" style={{ background: "var(--color-tile-sunk)" }} />
        ))}
      </div>

      <h1 className="text-[20px] font-medium">
        {online ? "No window unit yet" : "Your phone is offline"}
      </h1>

      {online ? (
        <>
          <p className="max-w-[280px] text-[14px] leading-[1.6] text-ink-soft">
            Nothing has reported in yet. Start the desktop bridge on the computer that is
            cabled to the window unit, and this screen will fill in on its own.
          </p>
          <code
            className="rounded-full px-4 py-3 text-[12px] text-ink"
            style={{ background: "var(--color-tile-sunk)" }}
          >
            pnpm --filter @aperture/bridge dev --mock
          </code>
          <p className="max-w-[280px] text-[12px] leading-[1.6] text-ink-faint">
            Drop <code>--mock</code> once the Arduino is plugged in.
          </p>
        </>
      ) : (
        <p className="max-w-[280px] text-[14px] leading-[1.6] text-ink-soft">
          Reconnect to the internet to see the window unit. The buttons on the window
          frame keep working regardless.
        </p>
      )}
    </main>
  );
}
