import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PUBLISH, type ReportedState } from "@aperture/shared";

import { hasMeaningfulChange, shouldPublish } from "./publisher.ts";

const base: ReportedState = {
  position: 62,
  mode: "auto",
  tempLimit: 26,
  lightLimit: 700,
  temperature: 28.4,
  humidity: 64,
  light: 850,
  motorState: "idle",
  heatProtection: true,
  overrideEndsAt: null,
  battery: 78,
  updatedAt: 1_754_179_200_000,
};

describe("hasMeaningfulChange", () => {
  it("publishes the first reading", () => {
    assert.equal(hasMeaningfulChange(null, base), true);
  });

  it("ignores sensor noise below the thresholds", () => {
    const noisy: ReportedState = {
      ...base,
      temperature: base.temperature + 0.2,
      light: base.light + 20,
      humidity: base.humidity + 1,
      updatedAt: base.updatedAt + 1000,
    };
    assert.equal(hasMeaningfulChange(base, noisy), false);
  });

  it("publishes once a sensor moves past its threshold", () => {
    assert.equal(
      hasMeaningfulChange(base, { ...base, temperature: base.temperature + PUBLISH.temperatureDeltaC }),
      true,
    );
    assert.equal(
      hasMeaningfulChange(base, { ...base, light: base.light - PUBLISH.lightDeltaLux }),
      true,
    );
    assert.equal(
      hasMeaningfulChange(base, { ...base, humidity: base.humidity + PUBLISH.humidityDeltaPct }),
      true,
    );
  });

  it("publishes any change the user would notice", () => {
    assert.equal(hasMeaningfulChange(base, { ...base, position: 63 }), true);
    assert.equal(hasMeaningfulChange(base, { ...base, mode: "manual" }), true);
    assert.equal(hasMeaningfulChange(base, { ...base, motorState: "moving" }), true);
    assert.equal(hasMeaningfulChange(base, { ...base, heatProtection: false }), true);
    assert.equal(hasMeaningfulChange(base, { ...base, overrideEndsAt: 123 }), true);
  });

  it("treats losing battery telemetry as a change", () => {
    assert.equal(hasMeaningfulChange(base, { ...base, battery: null }), true);
  });
});

describe("shouldPublish", () => {
  it("holds back an unchanged reading until the heartbeat lapses", () => {
    const unchanged = { ...base, updatedAt: base.updatedAt + 1000 };
    assert.equal(shouldPublish(base, unchanged, PUBLISH.heartbeatMs - 1), false);
    assert.equal(shouldPublish(base, unchanged, PUBLISH.heartbeatMs), true);
  });
});
