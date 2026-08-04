"use client";

import { DEFAULTS, RANGES } from "@aperture/shared";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { RadialDial } from "@/components/RadialDial";
import { ScreenTitle, Tile, Toggle } from "@/components/chrome";
import { setDesired, useDevice } from "@/lib/firebase/device";
import { ruleSentence } from "@/lib/format";
import { useDebouncedCallback } from "@/lib/hooks";

const DIAL_DEBOUNCE_MS = 400;

export default function AutomationScreen(): React.JSX.Element {
  const { reported, desired, controlsEnabled } = useDevice();

  // Threshold dials are dragged locally so the rule sentence can update on every
  // frame; the debounced write is what actually reaches Firebase.
  const [tempLimit, setTempLimit] = useState<number | null>(null);
  const [lightLimit, setLightLimit] = useState<number | null>(null);

  const committedTemp = desired?.tempLimit ?? reported?.tempLimit ?? DEFAULTS.tempLimit;
  const committedLight = desired?.lightLimit ?? reported?.lightLimit ?? DEFAULTS.lightLimit;

  // Once a write lands, stop overriding with the local drag value.
  useEffect(() => setTempLimit(null), [committedTemp]);
  useEffect(() => setLightLimit(null), [committedLight]);

  const write = useCallback((patch: { tempLimit?: number; lightLimit?: number }) => {
    void setDesired(patch).catch(() => {
      toast.error("Couldn't save that rule", { description: "Your change was not applied." });
    });
  }, []);

  const debouncedTemp = useDebouncedCallback((value: number) => write({ tempLimit: value }), DIAL_DEBOUNCE_MS);
  const debouncedLight = useDebouncedCallback((value: number) => write({ lightLimit: value }), DIAL_DEBOUNCE_MS);

  const shownTemp = tempLimit ?? committedTemp;
  const shownLight = lightLimit ?? committedLight;

  const manual = reported?.mode === "manual";
  const dimmed = manual || !controlsEnabled;

  // Notification preferences are local to this browser: PRD §16 rules out
  // accounts, so there is nowhere shared to keep them.
  const [resumeAuto, setResumeAuto] = useState(true);
  const [notifyHeat, setNotifyHeat] = useState(true);
  const [notifyOffline, setNotifyOffline] = useState(false);

  return (
    <main className="flex flex-col gap-4 px-4 pb-32 pt-3">
      <ScreenTitle>Automation rules</ScreenTitle>

      <Tile
        className="flex flex-col items-center gap-2"
        style={{ opacity: dimmed ? 0.55 : 1, transition: "opacity 240ms ease" }}
      >
        <div className="self-start text-[12px] font-medium text-ink-soft">Close blinds above</div>
        <RadialDial
          value={shownTemp}
          min={RANGES.tempLimit.min}
          max={RANGES.tempLimit.max}
          step={1}
          size="md"
          unit="°C"
          label="Close blinds above"
          capLeft={`${RANGES.tempLimit.min}°`}
          capRight={`${RANGES.tempLimit.max}°`}
          disabled={!controlsEnabled}
          onChange={(value) => {
            setTempLimit(value);
            debouncedTemp.call(value);
          }}
          onDragChange={(dragging) => {
            if (!dragging) debouncedTemp.flush();
          }}
        />
        <div className="text-center text-[14px] leading-[1.6] text-ink-soft">
          Blinds close when the room gets hotter than this.
        </div>
      </Tile>

      <Tile
        className="flex flex-col items-center gap-2"
        style={{ opacity: dimmed ? 0.55 : 1, transition: "opacity 240ms ease" }}
      >
        <div className="self-start text-[12px] font-medium text-ink-soft">Sunlight trigger</div>
        <RadialDial
          value={shownLight}
          min={RANGES.lightLimit.min}
          max={RANGES.lightLimit.max}
          step={25}
          size="md"
          tone="slate"
          unit="lux"
          label="Sunlight trigger"
          capLeft={String(RANGES.lightLimit.min)}
          capRight={String(RANGES.lightLimit.max)}
          disabled={!controlsEnabled}
          onChange={(value) => {
            setLightLimit(value);
            debouncedLight.call(value);
          }}
          onDragChange={(dragging) => {
            if (!dragging) debouncedLight.flush();
          }}
        />
        <div className="text-center text-[14px] leading-[1.6] text-ink-soft">
          Only close when sunlight is stronger than this.
        </div>
      </Tile>

      {/* The rule as a live sentence. This updates on every drag frame — it is
          the clearest expression of recognition over recall in the product. */}
      <Tile className="flex flex-col gap-4">
        <div className="text-[12px] font-medium text-ink-soft">Rule preview</div>
        <div
          aria-live="polite"
          className="rounded-[20px] p-[18px] text-[14px] leading-[1.6] text-ink"
          style={{ background: "var(--color-tile-sunk)" }}
        >
          {reported === null
            ? "Once the window unit reports in, this will describe exactly what your limits will do."
            : ruleSentence(reported.temperature, reported.light, shownTemp, shownLight)}
        </div>
        <button
          type="button"
          disabled={!controlsEnabled}
          onClick={() => {
            setTempLimit(DEFAULTS.tempLimit);
            setLightLimit(DEFAULTS.lightLimit);
            write({ tempLimit: DEFAULTS.tempLimit, lightLimit: DEFAULTS.lightLimit });
          }}
          className="self-start rounded-full px-4 py-2.5 text-[12px] font-medium disabled:opacity-50"
          style={{ background: "var(--color-ink)", color: "var(--color-canvas)" }}
        >
          Reset to defaults
        </button>
      </Tile>

      <Tile className="flex flex-col !px-6 !py-2">
        <div style={{ borderBottom: "1px solid var(--color-tile-sunk)" }}>
          <Toggle
            checked={resumeAuto}
            onChange={setResumeAuto}
            label="Resume auto after manual override"
            description={`Automation restarts ${desired?.overrideTimeoutMin ?? DEFAULTS.overrideTimeoutMin} minutes after you touch the controls`}
          />
        </div>
        <div style={{ borderBottom: "1px solid var(--color-tile-sunk)" }}>
          <Toggle
            checked={notifyHeat}
            onChange={setNotifyHeat}
            label="Notify when blinds close for heat"
            description="A quiet push each time heat protection kicks in"
          />
        </div>
        <Toggle
          checked={notifyOffline}
          onChange={setNotifyOffline}
          label="Notify if the device goes offline"
          description="Tells you when the window unit stops reporting"
        />
      </Tile>
    </main>
  );
}
