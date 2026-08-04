"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";

import { AmbientCanvas } from "@/components/AmbientCanvas";
import { startDeviceSubscription } from "@/lib/firebase/device";

/**
 * Opens the Firebase listeners once for the whole tree, and registers the
 * service worker. Every screen reads from the store those listeners feed.
 */
export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  useEffect(() => startDeviceSubscription(), []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A failed registration costs offline support, nothing more.
    });
  }, []);

  return (
    <>
      <AmbientCanvas />
      {children}
      <Toaster position="top-center" richColors closeButton />
    </>
  );
}
