"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Trailing-edge debounce.
 *
 * The dials use this so a drag produces one Firebase write rather than fifty
 * (PRD §10). `flush` sends the pending value immediately, which is what a
 * pointer-release should do rather than waiting out the delay.
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delayMs: number,
): { call: (...args: A) => void; flush: () => void } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<A | null>(null);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const args = latest.current;
    latest.current = null;
    if (args !== null) callbackRef.current(...args);
  }, []);

  const call = useCallback(
    (...args: A) => {
      latest.current = args;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const pending = latest.current;
        latest.current = null;
        if (pending !== null) callbackRef.current(...pending);
      }, delayMs);
    },
    [delayMs],
  );

  return { call, flush };
}
