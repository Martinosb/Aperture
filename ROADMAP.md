# Aperture — Build Roadmap

This roadmap decomposes the PRD's build order (§13, M1–M8) into phases small enough
to execute and verify one at a time.

## How to use this roadmap

- Work phases **in order**. A phase is open only when every box in the previous
  phase — including its verification checklist — is ticked.
- Each phase lists its PRD sections. Read them **before** writing code for that phase.
- Tick checkboxes as tasks complete and commit the roadmap edit together with the
  work, using the phase's commit scope.
- **🧑 Human checkpoint** means stop and ask the user; the step cannot be completed
  autonomously. Never fake its outcome.
- If something in a phase seems to require deviating from the PRD, stop and raise it
  rather than improvising.

---

## Phase 0 — Governance ✅

Repo initialised with PRD, project rules, and this roadmap.

- [x] `.gitignore` covering `.env` and `service-account.json` before first commit
- [x] `CLAUDE.md` project rules
- [x] `ROADMAP.md`
- [x] Initial commit pushed to `origin main`

---

## Phase 1 — Workspace and contracts (M1)

**Read first:** PRD §3 (layout), §4 (RTDB schema), §5 (serial protocol), §14 (config).
**Commit scope:** `feat(shared)`, `chore`

### Tasks

- [x] Create pnpm workspace: root `package.json`, `pnpm-workspace.yaml`, exactly the
      layout in PRD §3
- [x] `packages/shared/src/types.ts` — TypeScript types for `desired`, `reported`,
      `connection`, `events`, `meta` exactly matching PRD §4 (unions for
      `mode`, `motorState`, event `kind`; nullable `battery`, `overrideEndsAt`)
- [x] `packages/shared/src/protocol.ts` — serial protocol constants and
      parse/serialise helpers for `STATE`, `EVENT`, `READY`, `SET`, `ACK`, `ERR`,
      `PING`/`PONG` lines per PRD §5, plus value ranges (position 0–100,
      tempLimit 18–35, lightLimit 0–1200, timeout 1–60) and defaults (26 / 700 / 15)
- [x] `packages/shared/src/paths.ts` — RTDB path helpers
      (`devicePath(id)`, `desiredPath(id)`, `reportedPath(id)`, `connectionPath(id)`,
      `eventsPath(id)`)
- [x] `.env.example` exactly as PRD §14
- [x] `database.rules.json` — auth required everywhere; authenticated user writes
      `desired` only; bridge service account writes `reported`, `connection`,
      `events` only (PRD §4 Rules)
- [x] Add `build` and `typecheck` scripts to every package; update the Commands
      section of `CLAUDE.md` if commands differ

### 🧑 Human checkpoint — Firebase provisioning _(deferred)_

Development runs against the local Firebase emulator (`pnpm emulators`), which
needs no cloud project — so phases 2–6 are unblocked. The real project is still
required before anyone can reach the app from a phone off this machine.

Ask the user to:
- [ ] Create a Firebase project and enable **Realtime Database**
- [ ] Deploy `database.rules.json`
- [ ] Enable the auth method the PWA will use (single shared auth per PRD §16)
- [ ] Download a service-account key to `apps/bridge/service-account.json`
- [ ] Copy `.env.example` → `.env` files and fill every value

### Verification

- [x] `pnpm install` succeeds from a clean checkout
- [x] `pnpm -r build` and `pnpm -r typecheck` pass with zero errors
- [x] `packages/shared` contains no `any`
- [x] Round-trip unit check: serialising then parsing a `STATE` line and a `SET`
      command returns the original values (`pnpm -r test`)

---

## Phase 2 — Bridge in mock mode (M2)

**Read first:** PRD §7 (all), §4 (schema), §2 (desired vs reported).
**Commit scope:** `feat(bridge)`

### Tasks

- [x] Bridge skeleton: `commander` CLI, `dotenv` config, `pino` logging, zod-validated
      env; builds with `tsup`, runs with `node dist/index.js`
- [x] `--mock` mode: synthetic telemetry with a diurnal light curve, temperature
      drifting with light, and an automation loop mirroring firmware logic
      (thresholds + hysteresis ±1.5 °C / ±60 lux)
- [x] Write throttling: publish to `/reported` on meaningful change only
      (ΔT ≥ 0.3 °C, ΔL ≥ 25 lux, ΔH ≥ 2 %, any position/mode/motorState change) or a
      30 s heartbeat; debounce 500 ms
- [x] `/desired` listener: diff against last known desired, act only on changed
      fields, mirror into `/reported` (mock "executes" instantly with a short
      simulated motor delay and `motorState: "moving"`)
- [x] Presence: `connection/online = true` on connect, `onDisconnect()` flips it
      false with server-timestamp `lastSeen`; heartbeat `lastSeen` every 20 s
- [x] Events: push mock `auto`/`manual` events to `/events`, trim to newest 100
- [x] Live status line output per PRD §7 CLI output

### Verification

- [x] Run `--mock`; in the Firebase console, `/reported` updates and respects the
      throttling rules
- [x] Edit `/desired/position` in the console → mock moves, `/reported` follows,
      an event appears
- [x] Kill the process (SIGKILL, not graceful) → within ~60 s Firebase itself flips
      `connection/online` to `false`
- [x] Generate >100 events → `/events` stays capped at 100

---

## Phase 3 — PWA shell and realtime binding (M3)

**Read first:** PRD §0.1 (design source), §8 (all), §9 (tokens), §10 (RadialDial), §11 Screen 1.
**Commit scope:** `feat(web)`

### 🧑 Human checkpoint — design import

- [ ] Ask the user to run `/design-login`, then import the Claude Design project from
      PRD §0.1 and read `Aperture.dc.html` and `support.js`
- [ ] If the MCP is unreachable, say so explicitly and build from PRD §9–11 — do not
      invent a different visual direction

### Tasks

- [ ] Next.js 16 app in `apps/web`: App Router, TS strict, Tailwind; design tokens
      from PRD §9 as CSS custom properties in `globals.css`, mapped into the
      Tailwind theme
- [ ] Install shadcn/ui: Button, Switch, Sheet, Tabs, Skeleton, Sonner
- [ ] `lib/firebase/device.ts`: `useDevice()`, `setDesired(patch)` (shallow merge +
      server timestamp), `useEvents(limit)`. All mutations go through `setDesired`;
      no component writes Firebase directly
- [ ] Zustand store fed by the subscription; track the three connection layers
      separately (browser↔Firebase, bridge↔Firebase, bridge↔Arduino freshness)
- [ ] `RadialDial` component per PRD §10: 240° arc, six layers, drag + tap + full
      keyboard support, `role="slider"` ARIA, sizes `lg`/`md`/`sm`, 400 ms debounce
      before `setDesired`
- [ ] Screen 1 (Control) per PRD §11: top bar with ConnectionChip, hero placeholder
      for the 3D window (Phase 4), lg dial, Auto/Manual SegmentedPill with
      explanation line, sensor tile row, StatusBanner; ambient canvas gradient
      cross-fading 1200 ms with thermal state
- [ ] "Adjusting…" flow per PRD §2: fire on write, reconcile on `reported`, 5 s
      timeout → "The window unit isn't responding" and revert dial

### Verification

- [ ] With the mock bridge running: drag the dial on the phone/browser → mock reacts →
      `reported` flows back and the UI reconciles (full cloud round trip)
- [ ] Dragging the dial produces one Firebase write per gesture, not fifty
- [ ] Stop the mock bridge → UI shows the device-offline state, controls disabled
      with a stated reason
- [ ] Dial fully keyboard-operable; screen reader announces value text
- [ ] `pnpm -r typecheck` passes; layout correct at 360 px portrait

---

## Phase 4 — Three.js WindowObject (M4)

**Read first:** PRD §10 WindowObject, §2 latency, §15 quality floor.
**Commit scope:** `feat(web)`

### Tasks

- [ ] `WindowObject` with the exact props in PRD §10; individual slat meshes rotating
      on their long axis
- [ ] Directional sun light with intensity mapped from `lightLevel`; striped shadows
      through slat gaps onto a floor plane, contrast scaling with light
- [ ] Slat rotation animates 900 ms `cubic-bezier(0.4, 0, 0.2, 1)`; drives from
      `reported`, animates toward target during "Adjusting…"
- [ ] Hero percentage numeral overlapping the lower-left of the object
- [ ] Performance: DPR capped at 2, `frameloop="demand"` + invalidate on state
      change, dispose geometries on unmount
- [ ] Static SVG fallback for `prefers-reduced-motion` and WebGL-unavailable

### Verification

- [ ] Position 0 → slats shut, cool tint, no light; 100 → open, warm flood
- [ ] Dragging the dial animates the slats live before the write lands
- [ ] No continuous render loop when idle (check devtools performance tab)
- [ ] Fallback renders with WebGL disabled and with reduced-motion enabled

---

## Phase 5 — Remaining screens (M5)

**Read first:** PRD §11 Screens 2–4, §12 (every state).
**Commit scope:** `feat(web)`

### Tasks

- [ ] Screen 2 — Automation: two md dials (Close blinds above 18–35 °C amber,
      Sunlight trigger 0–1200 lux slate) with helper lines; **live rule-preview
      sentence** rebuilt from dial values + current readings as the dials drag;
      "Reset to defaults" pill; the three toggle rows
- [ ] Screen 3 — Activity: summary tile with count + closed-proportion bar; working
      filter pills (All/Auto/Manual/Alerts); timeline tiles with icon badge, plain
      description, relative time, slat-position glyph; empty state per spec
- [ ] Screen 4 — Device: device tile with firmware + ConnectionChip + Reconnect;
      signal tile (sm ring); power tile (battery ring or "Powered by USB");
      calibration pill with explanation; offline banner
- [ ] All §12 states reachable and visually correct:
  - [ ] Heat protection active
  - [ ] Comfortable / open
  - [ ] Manual override with live countdown "Auto resumes in 12:04"
  - [ ] Adjusting (dial locked, numeral counting)
  - [ ] Device offline (reason stated, last-known values timestamped)
  - [ ] Browser offline (distinct sentence from device offline)
  - [ ] Motor fault
  - [ ] First run / no device (shows the exact bridge command to run)

### Verification

- [ ] Walk every §12 state using the mock bridge (kill it, set mock fault, clear
      `/reported`, go airplane-mode) and confirm each renders per spec
- [ ] Rule-preview sentence updates live while dragging threshold dials
- [ ] Activity filters work; event cap of 100 respected in UI

---

## Phase 6 — PWA polish (M6)

**Read first:** PRD §8 PWA requirements, §15 quality floor.
**Commit scope:** `feat(web)`, `chore(web)`

### Tasks

- [ ] `manifest.json`: name, short name, `display: standalone`,
      `theme_color #FFC42E`, `background_color #FFF6DC`, maskable icons 192 + 512
- [ ] Service worker caching the app shell only — **never** Firebase RTDB responses
- [ ] Offline screen: last-known values with explicit "last updated" stamp and
      offline banner; cached numbers never presented as current
- [ ] `apple-touch-icon`, `apple-mobile-web-app-capable`, install prompt
- [ ] Safe-area insets for notched devices; visible keyboard focus everywhere;
      reduced-motion shortens slat/dial motion to 150 ms (not removed)

### Verification

- [ ] Lighthouse PWA audit passes
- [ ] Installable on Android and iOS
- [ ] Airplane mode → shell loads, offline screen with timestamp, no stale data
      shown as live

---

## Phase 7 — Arduino firmware (M7)

**Read first:** PRD §6 (all), §5 (protocol rules).
**Commit scope:** `feat(firmware)`

### Tasks — implement each FR as its own checklist item

- [ ] Pin setup per the §6 hardware table; libraries: DHT, AccelStepper,
      LiquidCrystal_I2C, EEPROM
- [ ] FR-1.1 heat-blocking close (temp > tempLimit AND light > lightLimit) + `EVENT AUTO`
- [ ] FR-1.2 optimal-light auto-open + `EVENT AUTO`
- [ ] FR-1.3 LCD readout, exact two-line format, works with USB unplugged
- [ ] FR-1.4 button overrides, 50 ms software debounce, auto-resume after
      `overrideTimeoutMin` with event
- [ ] FR-1.5 EEPROM persistence with magic byte; defaults 26 / 700 / 15
- [ ] FR-1.6 de-energise all four coil pins the moment movement completes
- [ ] FR-1.7 hysteresis ±1.5 °C and ±60 lux
- [ ] FR-1.8 non-blocking loop — zero `delay()` in `loop()`, `millis()` scheduling,
      `AccelStepper::run()`
- [ ] FR-1.9 stall detection → `MS:FAULT` + `EVENT ALERT`
- [ ] Serial: `STATE` every 1000 ms, `READY FW:x.y.z` on boot, `ACK`/`ERR` for every
      `SET`, unrecognised lines ignored silently

### Verification

- [ ] `arduino-cli compile --fqbn arduino:avr:uno firmware/aperture` succeeds
- [ ] Static review against each FR checkbox — especially: no `delay()` in `loop()`,
      coil pins written LOW after moves, EEPROM magic-byte path
- [ ] Every emitted line parses with `packages/shared` protocol helpers (paste
      samples into the round-trip test from Phase 1)

---

## Phase 8 — Hardware integration (M8)

**Read first:** PRD §2 (load-bearing decision), §7 items 1–8, §15.
**Commit scope:** `feat(bridge)`, `fix(firmware)`, `fix(bridge)`

### 🧑 Human checkpoint — hardware

- [ ] Ask the user to wire the board per the §6 table and connect it over USB

### Tasks

- [ ] Real serial path in the bridge: auto-discovery (Arduino/CH340/FTDI, `--port`
      override, retry every 5 s if absent), readline parsing, zod validation,
      malformed lines discarded with a warning
- [ ] Command path: clamp values before serial write; await `ACK` 2000 ms → retry
      once → `alert` event; mirror to `/reported` only after `ACK`
- [ ] `READY` handling: re-push the full current `/desired` to the board
- [ ] Serial reconnection: survive cable yank/replug without restart; mark offline
      while down
- [ ] Tune thresholds and hysteresis against real sensor noise with the user

### Verification — run each drill with the user

- [ ] Phone → blinds: dial change moves the physical motor; round trip within the
      250–800 ms + motion expectation, UI reconciles from `reported`
- [ ] Blinds → phone: physical button press appears in the app as MANUAL + event
- [ ] Yank USB mid-session → bridge retries, app shows device offline, blinds keep
      automating locally; replug → recovers with no restart
- [ ] Press board reset → bridge sees `READY`, re-pushes desired, no divergence
- [ ] Kill Wi-Fi on the bridge machine → `onDisconnect` fires; restore → recovers
- [ ] Full §15 quality floor pass

---

## Done means

All phases ticked, every §12 state demonstrable, Lighthouse PWA passing, and the
§15 survival drills green. Nothing from §16 built.
