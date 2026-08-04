import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DesiredState, ReportedState, Telemetry } from "@aperture/shared";

import { composeReported, diffDesired, type KnownLimits } from "./state.ts";

const limits: KnownLimits = { tempLimit: 26, lightLimit: 700, overrideTimeoutMin: 15 };

const telemetry: Telemetry = {
  temperature: 28.4,
  humidity: 64,
  light: 850,
  position: 62,
  mode: "auto",
  motorState: "idle",
  heatProtection: true,
  battery: 78,
};

const NOW = 1_754_179_200_000;

describe("composeReported", () => {
  it("supplies the thresholds the board does not echo back", () => {
    const reported = composeReported(telemetry, limits, null, NOW);
    assert.equal(reported.tempLimit, 26);
    assert.equal(reported.lightLimit, 700);
    assert.equal(reported.updatedAt, NOW);
  });

  it("stamps an override deadline when the board first reports manual", () => {
    const manual: Telemetry = { ...telemetry, mode: "manual" };
    const reported = composeReported(manual, limits, null, NOW);
    assert.equal(reported.overrideEndsAt, NOW + 15 * 60_000);
  });

  it("holds the deadline steady while manual continues", () => {
    const manual: Telemetry = { ...telemetry, mode: "manual" };
    const first = composeReported(manual, limits, null, NOW);
    const second = composeReported(manual, limits, first, NOW + 5_000);
    assert.equal(second.overrideEndsAt, first.overrideEndsAt);
  });

  it("clears the deadline the moment the board returns to auto", () => {
    const manual = composeReported({ ...telemetry, mode: "manual" }, limits, null, NOW);
    const back = composeReported(telemetry, limits, manual, NOW + 1_000);
    assert.equal(back.overrideEndsAt, null);
  });
});

describe("diffDesired", () => {
  const desired: DesiredState = {
    position: 62,
    mode: "auto",
    tempLimit: 26,
    lightLimit: 700,
    overrideTimeoutMin: 15,
    updatedAt: NOW,
  };

  const settled = composeReported(telemetry, limits, null, NOW);

  it("pushes everything when the board's state is unknown", () => {
    const kinds = diffDesired(null, desired, null).map((command) => command.kind);
    assert.deepEqual(kinds, [
      "tempLimit",
      "lightLimit",
      "overrideTimeoutMin",
      "position",
      "mode",
    ]);
  });

  it("sends nothing when nothing changed", () => {
    assert.deepEqual(diffDesired(desired, { ...desired, updatedAt: NOW + 1 }, settled), []);
  });

  it("sends only what changed", () => {
    const next: DesiredState = { ...desired, position: 80 };
    assert.deepEqual(diffDesired(desired, next, settled), [{ kind: "position", value: 80 }]);
  });

  it("orders mode after position, because SET P implies manual", () => {
    const next: DesiredState = { ...desired, position: 80, mode: "manual" };
    const kinds = diffDesired(desired, next, settled).map((command) => command.kind);
    assert.deepEqual(kinds, ["position", "mode"]);
  });

  it("does not re-send a position the board already holds", () => {
    // A full re-push on startup or after a board reset must not move anything:
    // SET P implies MANUAL, so restating the current position would silently
    // cancel automation and log an event the user never caused.
    const kinds = diffDesired(null, desired, settled).map((command) => command.kind);
    assert.deepEqual(kinds, ["overrideTimeoutMin"]);
  });

  it("still corrects the board when it disagrees with desired", () => {
    const drifted = { ...settled, position: 10, mode: "manual" as const };
    const kinds = diffDesired(null, desired, drifted).map((command) => command.kind);
    assert.deepEqual(kinds, ["overrideTimeoutMin", "position", "mode"]);
  });
});

describe("composeReported carries sensors through untouched", () => {
  it("keeps every reading the PWA renders", () => {
    const reported: ReportedState = composeReported(telemetry, limits, null, NOW);
    assert.equal(reported.temperature, 28.4);
    assert.equal(reported.humidity, 64);
    assert.equal(reported.light, 850);
    assert.equal(reported.heatProtection, true);
    assert.equal(reported.battery, 78);
  });
});
