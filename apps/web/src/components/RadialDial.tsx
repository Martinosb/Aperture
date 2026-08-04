"use client";

import { useCallback, useId, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

/**
 * The signature control (PRD §10): a 240° arc with the gap at the bottom,
 * sweeping clockwise from 7 o'clock to 5 o'clock.
 *
 * Geometry is taken from the design prototype rather than re-derived — the tick
 * spacing, knob proportions and readout sizes are what make it recognisable.
 *
 * There is no typed input anywhere in this product, so this component carries
 * every adjustable value. It must therefore be fully operable by pointer *and*
 * keyboard, and correctly announced.
 */

export type DialSize = "lg" | "md" | "sm";
export type DialTone = "amber" | "slate";

export interface RadialDialProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  size?: DialSize;
  tone?: DialTone;
  unit?: string;
  label: string;
  capLeft?: string;
  capRight?: string;
  decimals?: number;
  /** Overrides the centre readout text; the raw value is used otherwise. */
  display?: string;
  disabled?: boolean;
  onChange?: (value: number) => void;
  /** Fired when a drag begins and ends, so callers can preview live. */
  onDragChange?: (dragging: boolean) => void;
}

/** Arc starts at 150° (7 o'clock) and sweeps 240° clockwise. */
const START_ANGLE = 150;
const SWEEP = 240;
const TICK_COUNT = 40;

const SIZES: Record<DialSize, { box: number; stroke: number; readout: number }> = {
  lg: { box: 280, stroke: 14, readout: 76 },
  md: { box: 200, stroke: 12, readout: 58 },
  sm: { box: 56, stroke: 6, readout: 0 },
};

export function RadialDial({
  value,
  min,
  max,
  step = 1,
  size = "lg",
  tone = "amber",
  unit = "",
  label,
  capLeft,
  capRight,
  decimals = 0,
  display,
  disabled = false,
  onChange,
  onDragChange,
}: RadialDialProps): React.JSX.Element {
  const gradientId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const { box, stroke, readout } = SIZES[size];
  const isGauge = size === "sm";
  const interactive = !isGauge && !disabled && onChange !== undefined;

  const clamped = Math.min(max, Math.max(min, value));
  const span = max - min;
  const fraction = span === 0 ? 0 : (clamped - min) / span;

  // The gauge sits close to its edge; the interactive sizes leave room for ticks.
  const radius = box / 2 - (isGauge ? stroke / 2 + 2 : stroke / 2 + 17);

  const pointAt = useCallback(
    (t: number, r: number): [number, number] => {
      const angle = ((START_ANGLE + SWEEP * t) * Math.PI) / 180;
      const centre = box / 2;
      return [centre + r * Math.cos(angle), centre + r * Math.sin(angle)];
    },
    [box],
  );

  const arcPath = useCallback(
    (from: number, to: number, r: number): string => {
      const [x0, y0] = pointAt(from, r);
      const [x1, y1] = pointAt(to, r);
      const largeArc = (to - from) * SWEEP > 180 ? 1 : 0;
      return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    },
    [pointAt],
  );

  const emit = useCallback(
    (raw: number) => {
      if (onChange === undefined) return;
      const increment = step === 0 ? 1 : step;
      const snapped = Math.round((raw - min) / increment) * increment + min;
      const bounded = Math.min(max, Math.max(min, snapped));
      onChange(Math.round(bounded * 100) / 100);
    },
    [onChange, step, min, max],
  );

  const valueFromPointer = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const element = svgRef.current;
      if (element === null) return;

      const rect = element.getBoundingClientRect();
      let degrees =
        (Math.atan2(
          event.clientY - (rect.top + rect.height / 2),
          event.clientX - (rect.left + rect.width / 2),
        ) *
          180) /
        Math.PI;

      if (degrees < START_ANGLE) degrees += 360;
      let t = (degrees - START_ANGLE) / SWEEP;

      // Past the end of the arc, snap to whichever end is nearer rather than
      // letting the value jump across the gap at the bottom.
      if (t > 1) t = t > 1.25 ? 0 : 1;

      emit(min + t * span);
    },
    [emit, min, span],
  );

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (!interactive) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    onDragChange?.(true);
    valueFromPointer(event);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    if (!dragging || !interactive) return;
    valueFromPointer(event);
  };

  const endDrag = (): void => {
    if (!dragging) return;
    setDragging(false);
    onDragChange?.(false);
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (!interactive) return;
    const coarse = span / 10;
    let next: number | null = null;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = clamped + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = clamped - step;
        break;
      case "PageUp":
        next = clamped + coarse;
        break;
      case "PageDown":
        next = clamped - coarse;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }

    event.preventDefault();
    emit(next);
  };

  const ticks: React.JSX.Element[] = [];
  if (!isGauge) {
    for (let i = 0; i <= TICK_COUNT; i += 1) {
      const t = i / TICK_COUNT;
      const long = i % 5 === 0;
      const [x1, y1] = pointAt(t, radius + stroke / 2 + 5);
      const [x2, y2] = pointAt(t, radius + stroke / 2 + (long ? 14 : 9));
      ticks.push(
        <line
          key={i}
          x1={x1.toFixed(2)}
          y1={y1.toFixed(2)}
          x2={x2.toFixed(2)}
          y2={y2.toFixed(2)}
          stroke="#A39C90"
          strokeWidth={long ? 1.7 : 1}
          strokeLinecap="round"
          opacity={long ? 0.6 : 0.34}
        />,
      );
    }
  }

  const [knobX, knobY] = pointAt(fraction, radius);
  const readoutText = display ?? clamped.toFixed(decimals);
  const arcStroke = tone === "slate" ? "#4A6572" : `url(#${gradientId})`;

  return (
    <div className="relative inline-grid place-items-center leading-none">
      <svg
        ref={svgRef}
        width={box}
        height={box}
        viewBox={`0 0 ${box} ${box}`}
        role="slider"
        tabIndex={interactive ? 0 : -1}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={`${readoutText} ${unit}`.trim()}
        aria-disabled={disabled || undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
        style={{
          display: "block",
          touchAction: "none",
          borderRadius: 999,
          cursor: interactive ? "pointer" : "default",
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#FFC42E" />
            <stop offset="100%" stopColor="#F59A0B" />
          </linearGradient>
        </defs>

        <g>{ticks}</g>

        <path
          d={arcPath(0, 1, radius)}
          fill="none"
          stroke="#E8E5DE"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={arcPath(0, Math.max(0.001, fraction), radius)}
          fill="none"
          stroke={arcStroke}
          strokeWidth={stroke}
          strokeLinecap="round"
          opacity={disabled ? 0.4 : 1}
        />

        {!isGauge && (
          <g>
            <circle cx={knobX.toFixed(2)} cy={knobY.toFixed(2)} r={17} fill="#14110D" opacity={0.12} />
            <circle cx={knobX.toFixed(2)} cy={knobY.toFixed(2)} r={15} fill="#14110D" />
            <circle cx={knobX.toFixed(2)} cy={knobY.toFixed(2)} r={5} fill="#FFC42E" />
          </g>
        )}
      </svg>

      {!isGauge && (
        <div className="pointer-events-none absolute flex flex-col items-center gap-1">
          <div
            className="font-medium text-ink"
            style={{
              fontSize: readout,
              letterSpacing: "-0.04em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {readoutText}
          </div>
          {unit !== "" && <div className="text-[14px] font-normal text-ink-soft">{unit}</div>}
        </div>
      )}

      {capLeft !== undefined && (
        <div className="absolute bottom-2 left-0.5 text-[12px] font-medium text-ink-faint">
          {capLeft}
        </div>
      )}
      {capRight !== undefined && (
        <div className="absolute right-0.5 bottom-2 text-[12px] font-medium text-ink-faint">
          {capRight}
        </div>
      )}
    </div>
  );
}
