"use client";

import { RANGES } from "@aperture/shared";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { RadialDial } from "@/components/RadialDial";
import { StatusBanner, Tile, TopBar } from "@/components/chrome";
import { WindowObject } from "@/components/WindowObject";
import { FirstRun } from "@/components/FirstRun";
import { setDesired, useAdjustmentWatchdog, useDevice, useNow } from "@/lib/firebase/device";
import {
  bannerSentence,
  formatCountdown,
  formatInteger,
  formatTemperature,
  humidityWord,
  lightWord,
  temperatureWord,
} from "@/lib/format";
import { useDebouncedCallback } from "@/lib/hooks";

/** Dial writes are debounced so one gesture is one write (PRD §10). */
const DIAL_DEBOUNCE_MS = 400;

export default function ControlScreen(): React.JSX.Element {
  const device = useDevice();
  const now = useNow(1000);
  const [dragValue, setDragValue] = useState<number | null>(null);

  const onTimeout = useCallback(() => {
    toast.error("The window unit isn't responding", {
      description: "The dial has been put back to the last value it reported.",
    });
  }, []);
  useAdjustmentWatchdog(onTimeout);

  const writePosition = useCallback((value: number) => {
    // Moving the blind by hand is a manual override; saying so keeps `/desired`
    // honest rather than letting the board drift out of the mode we claim.
    void setDesired({ position: value, mode: "manual" }).catch(() => {
      toast.error("Couldn't reach Firebase", { description: "Your change was not saved." });
    });
  }, []);

  const debounced = useDebouncedCallback(writePosition, DIAL_DEBOUNCE_MS);

  const { reported, connection, meta } = device;
  const lastSeenAgo = Math.max(0, now - (connection?.lastSeen ?? reported?.updatedAt ?? now));

  if (device.ready && reported === null) {
    return <FirstRun online={device.browserOnline} />;
  }

  const position = dragValue ?? device.displayPosition;
  const temperature = reported?.temperature ?? 0;
  const humidity = reported?.humidity ?? 0;
  const light = reported?.light ?? 0;
  const manual = reported?.mode === "manual";
  const locked = !device.controlsEnabled;

  const overrideRemaining =
    reported?.overrideEndsAt != null ? Math.max(0, reported.overrideEndsAt - now) : 0;

  const banner = bannerSentence({
    deviceOnline: device.deviceOnline,
    browserOnline: device.browserOnline,
    motorFault: reported?.motorState === "fault",
    heatProtection: reported?.heatProtection ?? false,
    position: Math.round(position),
    lastSeenMillisAgo: lastSeenAgo,
  });

  const modeExplanation = locked
    ? "Controls are unavailable until the window unit reconnects — nothing you tap here would reach the motor."
    : manual
      ? `Manual — automation resumes in ${formatCountdown(overrideRemaining)}.`
      : "Auto — blinds respond to heat and sunlight.";

  return (
    <main className="flex flex-col gap-4 px-4 pb-32 pt-3">
      <TopBar
        online={device.deviceOnline}
        lastSeenMillisAgo={lastSeenAgo}
        roomName={meta?.name ?? "Bedroom window"}
      />

      {/* Hero. The window sits directly on the canvas with a contact shadow,
          not inside a tile, and the numeral overlaps it so the two read as one
          composition (PRD §9, §10). */}
      <section className="relative mt-1 h-[268px]" aria-label="Window">
        <div
          className="absolute bottom-[52px] left-1/2 h-[22px] w-[150px] -translate-x-1/2 rounded-full"
          style={{
            background:
              device.thermal === "heat-gain" ? "rgba(245,154,11,.42)" : "rgba(74,101,114,.34)",
            filter: "blur(9px)",
            transition: "background 900ms ease",
          }}
        />
        <div
          className="absolute left-1/2 top-2 h-[196px] w-[236px] -translate-x-1/2 rounded-3xl"
          style={{
            background: device.thermal === "heat-gain" ? "#FFC42E" : "#A8BCC9",
            filter: "blur(26px)",
            opacity: 0.22 + (position / 100) * 0.62,
            transition: "opacity 900ms ease, background 1200ms linear",
          }}
        />

        <WindowObject
          position={position}
          lightLevel={light}
          thermalState={device.thermal}
          isMoving={reported?.motorState === "moving"}
        />

        {/* Hero numeral shows what the window IS, even while a request is in
            flight — the dial above carries what was asked for. */}
        <div className="pointer-events-none absolute bottom-[14px] left-0 flex flex-col">
          <div
            className="font-medium text-ink"
            style={{
              fontSize: 84,
              lineHeight: 0.86,
              letterSpacing: "-0.04em",
              fontVariantNumeric: "tabular-nums",
              textShadow: "0 2px 18px rgba(255,246,220,.75)",
            }}
          >
            {formatInteger(reported?.position ?? 0)}%
          </div>
          <div className="pl-[3px] text-[14px] text-ink-soft">
            {Math.round(reported?.position ?? 0) === 0 ? "shut" : "open"}
          </div>
        </div>

        {device.adjusting && (
          <div
            className="absolute right-0.5 top-1.5 inline-flex items-center gap-[6px] rounded-full px-3 py-[7px] text-[12px] font-medium"
            style={{ background: "var(--color-ink)", color: "var(--color-canvas)" }}
          >
            <span
              className="size-[6px] rounded-full"
              style={{ background: "var(--color-sun)", animation: "apPulse 900ms ease-in-out infinite" }}
            />
            Adjusting…
          </div>
        )}
      </section>

      <Tile className="flex flex-col items-center gap-1.5 pb-[18px]">
        <div className="self-start text-[12px] font-medium text-ink-soft">Blind position</div>
        <RadialDial
          value={position}
          min={RANGES.position.min}
          max={RANGES.position.max}
          step={1}
          size="lg"
          unit="% open"
          label="Blind position"
          capLeft="Closed"
          capRight="Open"
          disabled={locked || device.adjusting}
          onChange={(value) => {
            setDragValue(value);
            debounced.call(value);
          }}
          onDragChange={(dragging) => {
            if (!dragging) {
              debounced.flush();
              setDragValue(null);
            }
          }}
        />
        <div className="text-center text-[12px] text-ink-soft">
          {locked ? "Reconnect the window unit to move the blinds." : "Drag the knob — the slats follow."}
        </div>
      </Tile>

      <Tile className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2.5">
          <div className="text-[12px] font-medium text-ink-soft">Control mode</div>
          {manual && overrideRemaining > 0 && (
            <div
              className="inline-flex items-center gap-1.5 rounded-full px-[11px] py-[5px] text-[12px] font-medium text-shade"
              style={{ background: "rgba(74,101,114,.14)", fontVariantNumeric: "tabular-nums" }}
            >
              Auto resumes in {formatCountdown(overrideRemaining)}
            </div>
          )}
        </div>

        <div
          className="relative grid grid-cols-2 rounded-full p-1"
          style={{ background: "var(--color-tile-sunk)", opacity: locked ? 0.5 : 1 }}
        >
          <div
            className="absolute bottom-1 left-1 top-1 rounded-full"
            style={{
              width: "calc(50% - 4px)",
              background: "var(--color-sun)",
              boxShadow: "0 2px 6px rgba(245,154,11,.4)",
              transform: `translateX(${manual ? "100%" : "0%"})`,
              transition: "transform 240ms cubic-bezier(.34,1.56,.64,1)",
            }}
          />
          <button
            type="button"
            disabled={locked}
            aria-pressed={!manual}
            onClick={() => void setDesired({ mode: "auto" })}
            className="relative rounded-full py-[11px] text-[14px] font-medium"
            style={{ color: manual ? "var(--color-ink-soft)" : "var(--color-ink)" }}
          >
            Auto
          </button>
          <button
            type="button"
            disabled={locked}
            aria-pressed={manual}
            onClick={() => void setDesired({ mode: "manual" })}
            className="relative rounded-full py-[11px] text-[14px] font-medium"
            style={{ color: manual ? "var(--color-ink)" : "var(--color-ink-soft)" }}
          >
            Manual
          </button>
        </div>

        <div className="text-[14px] leading-[1.6] text-ink-soft">{modeExplanation}</div>
      </Tile>

      <Tile className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-[7px] text-[12px] font-medium text-ink-soft">
            <span className="size-3 rounded-full" style={{ border: "2px solid var(--color-ember)" }} />
            Room temp
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-medium"
              style={{ fontSize: 52, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}
            >
              {formatTemperature(temperature)}
            </span>
            <span className="text-[14px] text-ink-soft">°C</span>
          </div>
          <div className="text-[14px]">{temperatureWord(temperature)}</div>
        </div>
        <RadialDial value={temperature} min={14} max={36} size="sm" tone="amber" label="Room temperature gauge" />
      </Tile>

      <div className="grid grid-cols-2 gap-4">
        <Tile className="flex flex-col gap-2 !p-5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-soft">
            <span
              className="size-2.5"
              style={{ background: "var(--color-shade)", borderRadius: "2px 999px 999px 999px" }}
            />
            Humidity
          </div>
          <div className="flex items-baseline gap-1">
            <span
              className="font-medium"
              style={{ fontSize: 44, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}
            >
              {formatInteger(humidity)}
            </span>
            <span className="text-[14px] text-ink-soft">%</span>
          </div>
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[14px]">{humidityWord(humidity)}</span>
            <RadialDial value={humidity} min={0} max={100} size="sm" tone="slate" label="Humidity gauge" />
          </div>
        </Tile>

        <Tile className="flex flex-col gap-2 !p-5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-soft">
            <span
              className="size-2.5 rounded-full"
              style={{ background: "var(--color-sun)", boxShadow: "0 0 0 2px rgba(245,154,11,.35)" }}
            />
            Sunlight
          </div>
          <div className="flex items-baseline gap-1">
            <span
              className="font-medium"
              style={{ fontSize: 44, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}
            >
              {formatInteger(light)}
            </span>
            <span className="text-[14px] text-ink-soft">lux</span>
          </div>
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[14px]">{lightWord(light)}</span>
            <RadialDial value={light} min={0} max={1200} size="sm" tone="amber" label="Sunlight gauge" />
          </div>
        </Tile>
      </div>

      <StatusBanner text={banner.text} tone={banner.tone} />

      {!device.deviceOnline && reported !== null && (
        <p className="px-2 text-[12px] leading-[1.6] text-ink-faint">
          Last updated {Math.round(lastSeenAgo / 1000)}s ago. These are stored readings, not live ones.
        </p>
      )}
    </main>
  );
}
