"use client";

import type { EventKind } from "@aperture/shared";
import { useMemo, useState } from "react";

import { ScreenTitle, Tile } from "@/components/chrome";
import { useEvents } from "@/lib/firebase/device";
import { formatClock } from "@/lib/format";

const FILTERS = ["All", "Auto", "Manual", "Alerts"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_KIND: Record<Exclude<Filter, "All">, EventKind> = {
  Auto: "auto",
  Manual: "manual",
  Alerts: "alert",
};

const KIND_LABEL: Record<EventKind, string> = {
  auto: "Automatic",
  manual: "Manual",
  alert: "Alert",
};

/** A tiny window glyph showing where the slats were at that moment. */
function SlatGlyph({ position, kind }: { position: number; kind: EventKind }): React.JSX.Element {
  const tilt = Math.round((position / 100) * 74);
  const background = kind === "alert" ? "#4A6572" : position > 55 ? "#F59A0B" : "#4A6572";

  return (
    <div
      aria-hidden="true"
      className="flex size-[26px] flex-none flex-col justify-between overflow-hidden rounded-[5px] p-[3px]"
      style={{ background, perspective: 60 }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[3px] rounded-[1px]"
          style={{ background: "var(--color-tile)", transform: `rotateX(${tilt}deg)` }}
        />
      ))}
    </div>
  );
}

export default function ActivityScreen(): React.JSX.Element {
  const events = useEvents(100);
  const [filter, setFilter] = useState<Filter>("All");

  const visible = useMemo(
    () => (filter === "All" ? events : events.filter((event) => event.kind === FILTER_KIND[filter])),
    [events, filter],
  );

  const startOfToday = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }, []);

  const today = events.filter((event) => event.at >= startOfToday);
  const autoToday = today.filter((event) => event.kind === "auto").length;

  // Proportion of recorded events that left the blinds mostly shut — an honest
  // stand-in for "closed time" without storing history the PRD rules out.
  const closedShare =
    today.length === 0
      ? 0
      : Math.round((today.filter((event) => event.position <= 45).length / today.length) * 100);

  return (
    <main className="flex flex-col gap-4 px-4 pb-32 pt-3">
      <ScreenTitle>Activity today</ScreenTitle>

      <Tile className="flex flex-col gap-[18px]">
        <div className="flex flex-col gap-0.5">
          <div className="text-[12px] font-medium text-ink-soft">Auto adjustments today</div>
          <div
            className="font-medium"
            style={{ fontSize: 76, lineHeight: 1, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums" }}
          >
            {autoToday}
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <div
            className="flex h-2.5 overflow-hidden rounded-full"
            style={{ background: "var(--color-tile-sunk)" }}
          >
            <div
              style={{
                width: `${closedShare}%`,
                background: "linear-gradient(90deg,#FFC42E,#F59A0B)",
                transition: "width 600ms ease",
              }}
            />
          </div>
          <div className="flex gap-4 text-[12px] text-ink-faint">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: "var(--color-ember)" }} />
              Closed {closedShare}% of adjustments
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: "var(--color-tile-sunk)" }} />
              Open {100 - closedShare}%
            </span>
          </div>
        </div>
      </Tile>

      <div className="flex gap-2 overflow-x-auto px-1 py-0.5">
        {FILTERS.map((name) => {
          const active = filter === name;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(name)}
              className="flex-none rounded-full px-[18px] py-2.5 text-[14px] font-medium"
              style={{
                background: active ? "var(--color-sun)" : "var(--color-tile)",
                color: active ? "var(--color-ink)" : "var(--color-ink-soft)",
                transition: "background 180ms ease-out",
              }}
            >
              {name}
            </button>
          );
        })}
      </div>

      {visible.map((event) => {
        const badgeBg =
          event.kind === "alert"
            ? "rgba(229,72,77,.16)"
            : event.kind === "manual"
              ? "rgba(74,101,114,.16)"
              : "rgba(255,196,46,.28)";
        const badgeFg =
          event.kind === "alert" ? "#E5484D" : event.kind === "manual" ? "#4A6572" : "#F59A0B";

        return (
          <Tile key={event.id} className="flex items-center gap-3.5 !px-5 !py-[18px]">
            <div
              className="grid size-[38px] flex-none place-items-center rounded-full"
              style={{ background: badgeBg }}
            >
              <span className="size-3.5 rounded-[3px]" style={{ background: badgeFg }} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <div className="text-[14px] leading-[1.5] text-pretty">{event.message}</div>
              <div className="text-[12px] text-ink-faint">
                {KIND_LABEL[event.kind]} · {formatClock(event.at)}
              </div>
            </div>
            <SlatGlyph position={event.position} kind={event.kind} />
          </Tile>
        );
      })}

      {visible.length === 0 && (
        <Tile className="flex flex-col items-center gap-3.5 !px-6 !py-[34px] text-center">
          <div
            className="flex h-[62px] w-[74px] flex-col justify-between rounded-lg p-[7px]"
            style={{ border: "2px solid var(--color-tile-sunk)" }}
            aria-hidden="true"
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[2px]" style={{ background: "var(--color-tile-sunk)" }} />
            ))}
          </div>
          <div className="text-[14px] font-medium">
            {filter === "All" ? "No activity yet today." : `No ${filter.toLowerCase()} activity yet.`}
          </div>
          <div className="max-w-[230px] text-[12px] leading-[1.6] text-ink-faint">
            Events appear here as soon as the blinds move — automatically or by hand.
          </div>
        </Tile>
      )}
    </main>
  );
}
