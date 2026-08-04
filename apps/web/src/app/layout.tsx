import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";

import { BottomNav } from "@/components/chrome";
import { Providers } from "./providers";

import "./globals.css";

/*
 * A geometric grotesque with characterful numerals (PRD §9). The numbers carry
 * this design, so a neutral default like Inter would flatten it.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aperture",
  applicationName: "Aperture",
  description: "Automated window blind and HVAC balancing",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Aperture",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#FFC42E",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body>
        <Providers>
          <div className="relative mx-auto min-h-dvh max-w-[520px]">
            {children}
            <BottomNav />
          </div>
        </Providers>
      </body>
    </html>
  );
}
