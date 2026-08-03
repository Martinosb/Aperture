# Aperture — Project Rules

Aperture is an automated window-blind and HVAC-balancing system: an Arduino at a
window reads temperature, humidity, and light and tilts venetian blinds; a Node.js
desktop bridge relays state between the board and Firebase Realtime Database; a
mobile-first Next.js 16 PWA monitors and overrides it from anywhere.

## Documents — read in this order

1. **`ROADMAP.md`** — the execution order. Find the current phase and work only on it.
2. **`PRD.md`** — the full specification. Every phase references its sections.

Authority: the PRD wins on behaviour, data flow, and architecture. The Claude Design
prototype (PRD §0.1) wins on visual details. The roadmap wins on sequencing.

## Golden rules

1. **Follow the roadmap phase order strictly.** Never start a phase until the
   previous phase's verification checklist has passed. Never skip ahead "to save time".
2. **Never mark a task done without running its verification command** and seeing it
   pass. If verification fails, fix it before moving on — do not defer.
3. **PRD §16 out-of-scope is a hard no.** No multi-device support, no user accounts,
   no historical charts, no weather APIs, no time scheduling, no voice, no native
   builds, no OTA updates — and no abstractions "in anticipation" of them.
4. **The Arduino owns the automation loop** (PRD §2). It decides open/close locally
   from EEPROM thresholds. Firebase and the bridge only observe it and push new
   intent. Never move automation decisions into the bridge or the cloud.
5. **The UI renders `/reported`, never `/desired`.** When they disagree, show
   "Adjusting…". No optimistic UI that snaps to the requested value.
6. **All shared shapes live in `packages/shared` once.** RTDB schema types, serial
   protocol constants, and path helpers are declared there and imported by both
   apps. Never redeclare them locally.
7. **No typed input anywhere in the UI** (PRD §9). No text fields, number inputs, or
   linear sliders. Every adjustable value is a radial dial; secondary controls are
   pill toggles and segmented pills.
8. **Never commit secrets.** `.env` and `service-account.json` are gitignored — keep
   them that way. Never deploy open RTDB security rules, even in development.
9. **Validate at the boundaries.** The bridge clamps every value from the network
   before writing to serial; the firmware ignores unrecognised lines instead of
   halting.
10. **Stop and ask the user at human checkpoints** — anything needing Firebase
    credentials, `/design-login`, or physical hardware. Do not fabricate credentials
    or pretend hardware steps passed.

## Tech constraints

- pnpm workspace monorepo, layout exactly as PRD §3.
- TypeScript strict mode in both apps. No `any` in `packages/shared`.
- `apps/web`: Next.js 16 App Router, shadcn/ui, Tailwind, `@react-three/fiber` +
  `@react-three/drei`, `firebase` web SDK v10+, `zustand`. Realtime Database only —
  no Firestore.
- `apps/bridge`: TypeScript built with `tsup`; `serialport`,
  `@serialport/parser-readline`, `firebase-admin`, `dotenv`, `zod`, `pino` +
  `pino-pretty`, `commander`.
- `firmware/aperture/aperture.ino`: Arduino Uno R3; `DHT sensor library`,
  `AccelStepper`, `LiquidCrystal_I2C`, `EEPROM`. No `delay()` in `loop()`.
- Every number shown on screen is rounded. Serial protocol and RTDB schema exactly
  as PRD §4–5 — do not invent fields.

## Git discipline

- Work directly on `main`. Never force-push.
- Conventional Commits with a workspace scope:
  `feat(bridge): …`, `feat(web): …`, `feat(shared): …`, `feat(firmware): …`,
  `fix(…): …`, `chore: …`, `docs: …`.
- Commit only after the relevant verification passes; one logical change per commit.
- Push to `origin main` after each commit.
- Commit messages describe the change in plain professional language. Do not mention
  AI, Claude, assistants, or code generation anywhere in commits — no co-author
  trailers, no generated-with footers.
- When completing roadmap tasks, tick the checkboxes in `ROADMAP.md` and include
  that edit in the same commit as the work.

## Commands

Packages are named `@aperture/shared`, `@aperture/bridge`, `@aperture/web`.

- `pnpm install` — install all workspace dependencies
- `pnpm -r build` — build every package
- `pnpm -r typecheck` — typecheck every package
- `pnpm -r test` — run every package's tests
- `pnpm --filter @aperture/bridge dev --mock` — run the bridge with synthetic telemetry _(Phase 2)_
- `pnpm --filter @aperture/web dev` — run the PWA dev server _(Phase 3)_
- `arduino-cli compile --fqbn arduino:avr:uno firmware/aperture` — compile firmware _(Phase 7)_
- `firebase deploy --only database` — deploy `database.rules.json`

Tests use Node's built-in runner against TypeScript sources directly (Node 22+
strips types natively) — there is no test framework dependency. Keep it that way:
write `*.test.ts` beside the code, import with an explicit `.ts` extension.
