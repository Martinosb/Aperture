import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bannerSentence,
  connectionText,
  formatAgo,
  formatCountdown,
  formatTemperature,
  lightWord,
  ruleSentence,
  temperatureWord,
} from "./format.ts";

describe("rounding", () => {
  it("shows one decimal for temperature and never a float artefact", () => {
    assert.equal(formatTemperature(28.44999), "28.4");
    assert.equal(formatTemperature(21.0000001), "21.0");
  });
});

describe("plain-English labels", () => {
  it("names the temperature band", () => {
    assert.equal(temperatureWord(28.4), "Warm");
    assert.equal(temperatureWord(22.6), "Comfortable");
    assert.equal(temperatureWord(18), "Cool");
  });

  it("names the light band", () => {
    assert.equal(lightWord(850), "Bright");
    assert.equal(lightWord(410), "Soft");
    assert.equal(lightWord(90), "Dim");
  });
});

describe("time", () => {
  it("counts the override down as mm:ss", () => {
    assert.equal(formatCountdown(724_000), "12:04");
    assert.equal(formatCountdown(0), "0:00");
    assert.equal(formatCountdown(-500), "0:00");
  });

  it("scales the relative stamp", () => {
    assert.equal(formatAgo(4_000), "4s ago");
    assert.equal(formatAgo(120_000), "2 min ago");
    assert.equal(formatAgo(7_200_000), "2 hr ago");
  });

  it("says something different when offline, because the fix differs", () => {
    assert.equal(connectionText(true, 4_000), "Live · 4s ago");
    assert.equal(connectionText(false, 120_000), "Offline · last seen 2 min ago");
  });
});

describe("ruleSentence", () => {
  it("explains a closed blind when both readings are over", () => {
    const sentence = ruleSentence(28.4, 850, 26, 700);
    assert.match(sentence, /the room is 28\.4°C and sunlight is 850 lux/);
    assert.match(sentence, /Both are above your limits of 26°C and 700 lux, so the blinds are closed\./);
  });

  it("explains an open blind when both readings are under", () => {
    assert.match(ruleSentence(22.6, 410, 26, 700), /Both sit under your limits/);
  });

  it("explains each half-met case separately", () => {
    assert.match(ruleSentence(29, 410, 26, 700), /warmer than your 26°C limit, but sunlight is below 700 lux/);
    assert.match(ruleSentence(22, 850, 26, 700), /Sunlight is over your 700 lux limit, but the room is under 26°C/);
  });

  it("updates as the limits are dragged", () => {
    const before = ruleSentence(28.4, 850, 26, 700);
    const after = ruleSentence(28.4, 850, 30, 700);
    assert.notEqual(before, after);
    assert.match(after, /the blinds stay open/);
  });
});

describe("bannerSentence", () => {
  const base = {
    deviceOnline: true,
    browserOnline: true,
    motorFault: false,
    heatProtection: false,
    position: 88,
    lastSeenMillisAgo: 4000,
  };

  it("distinguishes the phone being offline from the unit being offline", () => {
    const phone = bannerSentence({ ...base, browserOnline: false });
    const unit = bannerSentence({ ...base, deviceOnline: false });
    assert.match(phone.text, /Your phone is offline/);
    assert.match(unit.text, /Can't reach the window unit/);
    assert.notEqual(phone.text, unit.text);
  });

  it("puts the phone being offline ahead of the unit, since that is the real fix", () => {
    const both = bannerSentence({ ...base, browserOnline: false, deviceOnline: false });
    assert.match(both.text, /Your phone is offline/);
  });

  it("reports a motor fault with the remedy", () => {
    assert.match(bannerSentence({ ...base, motorFault: true }).text, /re-calibrating/);
  });

  it("reads differently while still closing than once closed", () => {
    assert.match(bannerSentence({ ...base, heatProtection: true, position: 20 }).text, /Blinds closed/);
    assert.match(bannerSentence({ ...base, heatProtection: true, position: 70 }).text, /Blinds closing/);
  });
});
