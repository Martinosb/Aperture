/**
 * Every number that reaches the screen is rounded here (PRD §15) and every
 * plain-English label is derived here, so the wording stays consistent across
 * screens instead of drifting per component.
 */

export function formatTemperature(celsius: number): string {
  return celsius.toFixed(1);
}

export function formatInteger(value: number): string {
  return String(Math.round(value));
}

/** "Warm" / "Comfortable" / "Cool", matching the design prototype's bands. */
export function temperatureWord(celsius: number): string {
  if (celsius >= 27) return "Warm";
  if (celsius >= 21) return "Comfortable";
  return "Cool";
}

/** "Bright" / "Soft" / "Dim". */
export function lightWord(lux: number): string {
  if (lux >= 700) return "Bright";
  if (lux >= 300) return "Soft";
  return "Dim";
}

export function humidityWord(percent: number): string {
  if (percent >= 70) return "Humid";
  if (percent >= 40) return "Moderate";
  return "Dry";
}

export function signalWord(percent: number, online: boolean): string {
  if (!online) return "No link";
  if (percent > 70) return "Strong";
  if (percent > 40) return "Fair";
  return "Weak";
}

/** mm:ss, for the manual-override countdown. */
export function formatCountdown(millis: number): string {
  const total = Math.max(0, Math.round(millis / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** "4s ago", "2 min ago", "3 hr ago" — never a bare timestamp. */
export function formatAgo(millisAgo: number): string {
  const seconds = Math.max(0, Math.round(millisAgo / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

/** Clock time for an event row. */
export function formatClock(at: number): string {
  return new Date(at).toTimeString().slice(0, 5);
}

/**
 * The connection chip's sentence. The two states read differently on purpose —
 * "Live" carries a freshness age, "Offline" carries how long ago it was last seen.
 */
export function connectionText(online: boolean, lastSeenMillisAgo: number): string {
  if (online) return `Live · ${formatAgo(lastSeenMillisAgo)}`;
  return `Offline · last seen ${formatAgo(lastSeenMillisAgo)}`;
}

/**
 * The rule preview sentence (PRD §11 Screen 2).
 *
 * This is the clearest expression of recognition-over-recall in the product: it
 * states both current readings, both limits, and the consequence, and it updates
 * live as the threshold dials are dragged.
 */
export function ruleSentence(
  temperature: number,
  light: number,
  tempLimit: number,
  lightLimit: number,
): string {
  const opening = `Right now: the room is ${formatTemperature(temperature)}°C and sunlight is ${formatInteger(light)} lux. `;

  const tempAbove = temperature > tempLimit;
  const lightAbove = light > lightLimit;

  if (tempAbove && lightAbove) {
    return `${opening}Both are above your limits of ${formatInteger(tempLimit)}°C and ${formatInteger(lightLimit)} lux, so the blinds are closed.`;
  }
  if (!tempAbove && !lightAbove) {
    return `${opening}Both sit under your limits of ${formatInteger(tempLimit)}°C and ${formatInteger(lightLimit)} lux, so the blinds stay open.`;
  }
  if (tempAbove) {
    return `${opening}It is warmer than your ${formatInteger(tempLimit)}°C limit, but sunlight is below ${formatInteger(lightLimit)} lux — so the blinds stay open.`;
  }
  return `${opening}Sunlight is over your ${formatInteger(lightLimit)} lux limit, but the room is under ${formatInteger(tempLimit)}°C — so the blinds stay open.`;
}

/** The status banner's one plain sentence, for each reachable state. */
export function bannerSentence(options: {
  deviceOnline: boolean;
  browserOnline: boolean;
  motorFault: boolean;
  heatProtection: boolean;
  position: number;
  lastSeenMillisAgo: number;
}): { text: string; tone: "warm" | "cool" | "alert" } {
  if (!options.browserOnline) {
    return {
      text: "Your phone is offline. Values below are the last ones received.",
      tone: "alert",
    };
  }
  if (!options.deviceOnline) {
    return {
      text: `Can't reach the window unit — showing the last reading from ${formatAgo(options.lastSeenMillisAgo)}. The buttons on the frame still work.`,
      tone: "alert",
    };
  }
  if (options.motorFault) {
    return {
      text: "The blind motor is stuck. Try re-calibrating on the device screen.",
      tone: "alert",
    };
  }
  if (options.heatProtection) {
    return {
      text:
        options.position <= 40
          ? "Blinds closed to block heat gain — saving cooling energy."
          : "Blinds closing to block heat gain — saving cooling energy.",
      tone: "warm",
    };
  }
  return { text: "Open — conditions are comfortable, so daylight is let in.", tone: "cool" };
}
