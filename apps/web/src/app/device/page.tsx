"use client";

import { useState } from "react";
import { toast } from "sonner";

import { RadialDial } from "@/components/RadialDial";
import { ConnectionChip, ScreenTitle, StatusBanner, Tile } from "@/components/chrome";
import { setDesired, useDevice, useNow } from "@/lib/firebase/device";
import { formatAgo, formatInteger, signalWord } from "@/lib/format";

export default function DeviceScreen(): React.JSX.Element {
  const device = useDevice();
  const now = useNow(1000);
  const [calibrating, setCalibrating] = useState(false);

  const { reported, connection, meta } = device;
  const lastSeenAgo = Math.max(0, now - (connection?.lastSeen ?? reported?.updatedAt ?? now));

  // Link quality is inferred from telemetry freshness — there is no RSSI on a
  // USB link, and inventing a field the schema does not have would be a lie.
  const signal = !device.deviceOnline
    ? 0
    : Math.max(0, Math.min(100, Math.round(100 - (lastSeenAgo / 1000) * 3)));

  const battery = reported?.battery;
  const onUsbPower = battery === null || battery === undefined;

  const runCalibration = (): void => {
    if (calibrating || !device.controlsEnabled) return;
    setCalibrating(true);
    toast.info("Calibrating blind travel", {
      description: "The blind will run end to end. This takes about 40 seconds.",
    });

    // Teaching the motor its limits means driving to both ends and back, which
    // is a manual operation by definition.
    void (async () => {
      try {
        await setDesired({ position: 100, mode: "manual" });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await setDesired({ position: 0 });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await setDesired({ mode: "auto" });
        toast.success("Calibration finished");
      } catch {
        toast.error("Calibration could not finish");
      } finally {
        setCalibrating(false);
      }
    })();
  };

  return (
    <main className="flex flex-col gap-4 px-4 pb-32 pt-3">
      <ScreenTitle>Device</ScreenTitle>

      {!device.browserOnline && (
        <StatusBanner tone="alert" text="Your phone is offline. Nothing below is live." />
      )}
      {device.browserOnline && !device.deviceOnline && (
        <StatusBanner
          tone="alert"
          text="Can't reach the window unit. The physical buttons on the frame still work."
        />
      )}
      {reported?.motorState === "fault" && (
        <StatusBanner
          tone="alert"
          text="The blind motor is stuck. Try re-calibrating below."
        />
      )}

      <Tile className="flex flex-col gap-[18px]">
        <div className="flex items-center gap-[18px]">
          <div
            className="grid h-[78px] w-24 flex-none place-items-center rounded-[20px]"
            style={{ background: "var(--color-tile-sunk)", perspective: 340 }}
            aria-hidden="true"
          >
            <div
              className="relative h-[46px] w-[62px] rounded-md p-[7px]"
              style={{
                background: "linear-gradient(150deg,#2E5A4B,#1C3A30)",
                transform: "rotateX(52deg) rotateZ(-32deg)",
                boxShadow: "0 12px 16px -8px rgba(20,17,13,.5)",
              }}
            >
              <div
                className="size-5 rounded-[2px]"
                style={{ background: "#14110D", boxShadow: "0 0 0 1px rgba(255,255,255,.18)" }}
              />
              <div className="absolute right-1.5 top-[7px] flex flex-col gap-0.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-[2px] w-3.5" style={{ background: "#C9C2B4" }} />
                ))}
              </div>
              <div
                className="absolute bottom-1.5 right-2 size-[5px] rounded-full"
                style={{
                  background: device.deviceOnline ? "var(--color-live)" : "var(--color-alert)",
                  boxShadow: `0 0 6px ${device.deviceOnline ? "var(--color-live)" : "var(--color-alert)"}`,
                }}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="text-[14px] font-medium">Aperture · window unit</div>
            <div className="text-[12px] text-ink-faint">
              Firmware v{meta?.firmware ?? "—"} · {meta?.name ?? "Bedroom window"}
            </div>
            <ConnectionChip
              className="self-start !bg-[var(--color-tile-sunk)] !shadow-none"
              online={device.deviceOnline}
              lastSeenMillisAgo={lastSeenAgo}
            />
          </div>
        </div>

        <p className="text-[12px] leading-[1.6] text-ink-faint">
          The bridge reconnects on its own every five seconds. If it stays offline, check
          that the desktop bridge is running and the USB cable is seated.
        </p>
      </Tile>

      <div className="grid grid-cols-2 gap-4">
        <Tile className="flex flex-col gap-3 !p-5">
          <div className="text-[12px] font-medium text-ink-soft">Link quality</div>
          <div className="flex items-center gap-3">
            <RadialDial value={signal} min={0} max={100} size="sm" tone="slate" label="Link quality gauge" />
            <div className="flex flex-col gap-0.5">
              <div className="text-[14px] font-medium">{signalWord(signal, device.deviceOnline)}</div>
              <div className="text-[12px] text-ink-faint">{signal}%</div>
            </div>
          </div>
          <div className="text-[12px] leading-[1.5] text-ink-faint">
            Last sync {formatAgo(lastSeenAgo)}
          </div>
        </Tile>

        <Tile className="flex flex-col gap-3 !p-5">
          <div className="text-[12px] font-medium text-ink-soft">Power</div>
          <div className="flex items-center gap-3">
            <RadialDial
              value={onUsbPower ? 100 : battery}
              min={0}
              max={100}
              size="sm"
              tone="amber"
              label="Battery gauge"
            />
            <div className="flex flex-col gap-0.5">
              <div className="text-[14px] font-medium">
                {onUsbPower ? "USB" : `${formatInteger(battery)}%`}
              </div>
              <div className="text-[12px] text-ink-faint">{onUsbPower ? "Mains" : "Battery"}</div>
            </div>
          </div>
          <div className="text-[12px] leading-[1.5] text-ink-faint">
            {onUsbPower
              ? "Powered by USB"
              : `Running on battery — about ${Math.max(1, Math.round(((battery ?? 0) / 100) * 6))} hrs remaining`}
          </div>
        </Tile>
      </div>

      <Tile className="flex flex-col gap-3">
        <div className="text-[12px] font-medium text-ink-soft">Calibration</div>
        <button
          type="button"
          onClick={runCalibration}
          disabled={calibrating || !device.controlsEnabled}
          className="self-start rounded-full px-[18px] py-3 text-[14px] font-medium text-ink disabled:opacity-50"
          style={{ border: "1px solid var(--color-ink)", background: "transparent" }}
        >
          {calibrating ? "Calibrating…" : "Re-calibrate blind travel"}
        </button>
        <div className="text-[12px] leading-[1.6] text-ink-faint">
          Teaches the motor where fully open and fully closed are. Takes about 40 seconds,
          and the blind will travel end to end.
        </div>
      </Tile>
    </main>
  );
}
