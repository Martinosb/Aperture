"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { connectionText } from "@/lib/format";

/**
 * The frame every screen sits in: connection chip, title bar, and bottom nav.
 * Geometry and copy follow the design prototype.
 */

export function ConnectionChip({
  online,
  lastSeenMillisAgo,
  className = "",
}: {
  online: boolean;
  lastSeenMillisAgo: number;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={`flex min-w-0 max-w-full items-center gap-[7px] overflow-hidden rounded-full px-3 py-[7px] ${className}`}
      style={{ background: "rgba(255,255,255,.62)", boxShadow: "0 1px 3px rgba(20,17,13,.07)" }}
    >
      <span
        className="size-[6px] flex-none rounded-full"
        style={{
          background: online ? "var(--color-live)" : "var(--color-alert)",
          animation: "apPulse 2.4s ease-in-out infinite",
        }}
      />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
        {connectionText(online, lastSeenMillisAgo)}
      </span>
    </div>
  );
}

export function TopBar({
  online,
  lastSeenMillisAgo,
  roomName,
}: {
  online: boolean;
  lastSeenMillisAgo: number;
  roomName: string;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-1">
      <ConnectionChip className="justify-self-start" online={online} lastSeenMillisAgo={lastSeenMillisAgo} />
      <div className="min-w-0 truncate text-center text-[14px] font-medium">{roomName}</div>
      <Link
        href="/device"
        className="justify-self-end whitespace-nowrap rounded-full px-[13px] py-[7px] text-[12px] font-medium text-ink"
        style={{ background: "rgba(255,255,255,.62)", boxShadow: "0 1px 3px rgba(20,17,13,.07)" }}
      >
        Settings
      </Link>
    </div>
  );
}

const NAV = [
  { href: "/", label: "Control" },
  { href: "/automation", label: "Automation" },
  { href: "/activity", label: "Activity" },
  { href: "/device", label: "Device" },
] as const;

function NavIcon({ label, active }: { label: string; active: boolean }): React.JSX.Element {
  const color = active ? "var(--color-ink)" : "var(--color-ink-faint)";

  if (label === "Control") {
    return (
      <div className="flex h-4 w-5 flex-col justify-between">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[3px] rounded-[1px]" style={{ background: color }} />
        ))}
      </div>
    );
  }
  if (label === "Automation") {
    return (
      <div
        className="grid size-[18px] place-items-center rounded-full"
        style={{ border: `2.5px solid ${color}` }}
      >
        <div className="mb-1 h-[6px] w-[2px]" style={{ background: color }} />
      </div>
    );
  }
  if (label === "Activity") {
    return (
      <div className="flex h-[18px] w-full items-end justify-center gap-[3px]">
        {[8, 16, 11].map((h, i) => (
          <div key={i} className="w-[3px] rounded-[1px]" style={{ height: h, background: color }} />
        ))}
      </div>
    );
  }
  return <div className="size-[17px] rounded-[5px]" style={{ border: `2.5px solid ${color}` }} />;
}

export function BottomNav(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-[520px] grid-cols-4 gap-1 border-t px-[14px] pt-[10px]"
      style={{
        paddingBottom: "calc(22px + env(safe-area-inset-bottom))",
        background:
          "linear-gradient(180deg, rgba(244,242,237,0), rgba(244,242,237,.94) 42%)",
        backdropFilter: "blur(14px)",
        borderColor: "rgba(20,17,13,.06)",
      }}
    >
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="flex flex-col items-center gap-[6px] rounded-[18px] py-2"
            style={{ color: active ? "var(--color-ink)" : "var(--color-ink-faint)" }}
          >
            <NavIcon label={item.label} active={active} />
            <span className="text-[11px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function ScreenTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h1 className="px-1 pt-1 text-[20px] font-medium">{children}</h1>;
}

export function Tile({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}): React.JSX.Element {
  return (
    <div className={`tile p-6 ${className}`} style={style}>
      {children}
    </div>
  );
}

export function StatusBanner({
  text,
  tone,
}: {
  text: string;
  tone: "warm" | "cool" | "alert";
}): React.JSX.Element {
  const palette = {
    warm: { bg: "rgba(255,196,46,.18)", dot: "var(--color-ember)" },
    cool: { bg: "rgba(74,101,114,.12)", dot: "var(--color-shade)" },
    alert: { bg: "rgba(229,72,77,.14)", dot: "var(--color-alert)" },
  }[tone];

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-full px-5 py-4"
      style={{ background: palette.bg, transition: "background 1200ms linear" }}
    >
      <span
        className="mt-[2px] size-4 flex-none rounded"
        style={{ background: palette.dot }}
      />
      <div className="text-[14px] leading-[1.5] text-ink">{text}</div>
    </div>
  );
}

/** Pill switch, always paired with a label and a description (PRD §10). */
export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-[18px]">
      <div className="flex flex-col gap-[3px]">
        <div className="text-[14px] font-medium">{label}</div>
        <div className="text-[12px] leading-[1.5] text-ink-faint">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="h-[30px] w-[52px] flex-none cursor-pointer rounded-full p-[3px]"
        style={{
          background: checked ? "var(--color-sun)" : "var(--color-tile-sunk)",
          transition: "background 180ms ease-out",
        }}
      >
        <div
          className="size-6 rounded-full"
          style={{
            background: "var(--color-ink)",
            transform: `translateX(${checked ? "22px" : "0px"})`,
            transition: "transform 180ms ease-out",
          }}
        />
      </button>
    </div>
  );
}
