import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@aperture/shared"],
  // Pin the workspace root; a stray lockfile in a parent directory otherwise
  // makes Turbopack guess wrong.
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
};

export default nextConfig;
