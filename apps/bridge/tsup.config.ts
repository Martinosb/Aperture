import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  // serialport ships native bindings; keep it external so the prebuilt binary is used.
  external: ["serialport", "@serialport/parser-readline", "firebase-admin"],
  banner: { js: "#!/usr/bin/env node" },
});
