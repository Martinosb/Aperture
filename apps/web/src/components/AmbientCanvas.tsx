"use client";

import { useDevice } from "@/lib/firebase/device";

/**
 * The page background encodes the room's thermal state (PRD §9).
 *
 * Both gradients stay mounted and only their opacity changes, so switching
 * between them is a true 1200ms cross-fade rather than a repaint. This is a
 * signal, not decoration: the room's condition should be readable from
 * peripheral vision before a single word is.
 */
export function AmbientCanvas(): React.JSX.Element {
  const { thermal, deviceOnline } = useDevice();

  // With the unit unreachable there is no current thermal reading to report, so
  // the canvas settles to the neutral cool state rather than implying one.
  const warm = deviceOnline && thermal === "heat-gain" ? 1 : 0;

  return (
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{ background: "var(--gradient-comfortable)", opacity: 1 - warm, transition: "opacity 1200ms linear" }}
      />
      <div
        className="absolute inset-0"
        style={{ background: "var(--gradient-heat)", opacity: warm, transition: "opacity 1200ms linear" }}
      />
    </div>
  );
}
