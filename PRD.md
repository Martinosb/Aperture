# Aperture — Product Requirements Document

**Automated window blind and HVAC balancing system**
Build target: a mobile-first PWA, a Node.js desktop bridge, and Arduino firmware.

---

## 0. Handoff prompt

> You are to use Next.js 16 and shadcn/ui and Three.js to create a PWA optimized for
> mobile displays. The app will be connected to an Arduino kit. This app will have a
> desktop Node.js app that will stream data to and from the Arduino board and stream
> it to Firebase using Firebase Realtime Database. This is the flow of the setup: we
> will use the web app to control the Arduino board by the PWA → Firebase Realtime →
> desktop Node.js app will fetch and execute the instruction → Arduino board. And
> vice versa, thus to read data from the Arduino board.

This document is the full specification behind that prompt. Where the two disagree,
this document wins.

---

## 0.1 Design source — read this first

The visual design already exists. **Before writing any frontend code, import and read
the prototype from Claude Design.**

Use the `claude_design` MCP (`https://api.anthropic.com/v1/design/mcp`, auth via
`/design-login`) to import this project:

```
https://claude.ai/design/p/93b9bd9f-ad07-45b6-9da2-65ce22aa28e2?file=Aperture.dc.html
```

Focus on these files (the whole project is readable):
- `Aperture.dc.html`

Also read these files the selection imports:
- `support.js`

Implement: `Aperture.dc.html`

The prototype is the authoritative visual reference. Take the actual layout, spacing,
component structure, motion, and copy from it. The tokens and component descriptions
in §9–10 of this document are a written summary of that same design, provided so the
spec stands alone if the project is unreachable. **Where the prototype and this
document differ on a visual detail, the prototype wins.** Where they differ on
behaviour, data flow, or architecture, this document wins.

Specifically, pull from the prototype:
- Exact spacing, sizing, and layout proportions per breakpoint
- The RadialDial's rendered geometry, tick spacing, and knob treatment
- Motion curves and timings as actually implemented
- Final copy for every label, status sentence, and empty state
- Component composition and hierarchy

Note that `Aperture.dc.html` is a single-file prototype. Porting it to Next.js 16
means decomposing it into React components and wiring its state to the Firebase
subscription layer described in §8 — not transcribing it verbatim. Preserve the
visuals and the interaction feel; replace its internal mock state with real device
state.

If the MCP connection is unavailable, say so explicitly and build from §9–11 rather
than inventing a different visual direction.

---

## 1. What this product does

An Arduino at a window reads room temperature, humidity, and sunlight intensity, and
drives a stepper motor that tilts venetian blind slats. When the room is hot **and**
direct sun is hitting the glass, the blinds close to block thermal heat gain. When
the room is comfortable and light is soft, they open to let daylight in. The result
is lower cooling load and less air-conditioning cost.

The user monitors and overrides this from a phone, anywhere, over the internet.

**Users and their goals**

| Role | Goal | Why it matters |
|---|---|---|
| Homeowner | See room temperature, humidity, and light remotely | Know the room's condition without being there |
| Homeowner | Open or close blinds from the phone | Override automation when the machine gets it wrong |
| Facility manager | Change temperature and light thresholds from the app | Retune behaviour without reflashing firmware |
| Physical operator | Press buttons on the window frame | Local control that works when the network is down |

---

## 2. System architecture

Four tiers. Each one is a separate deliverable in this repository.

```
┌─────────────────────────────────────────────┐
│  TIER 1 — PWA (Next.js 16 + Three.js)       │
│  Phone / desktop browser. Installable.      │
└───────────────┬─────────────────────────────┘
                │  Firebase SDK
                │  write → /devices/{id}/desired
                │  listen ← /devices/{id}/reported
                ▼
┌─────────────────────────────────────────────┐
│  TIER 2 — Firebase Realtime Database        │
│  Single source of truth. Desired vs         │
│  reported state. Survives both endpoints    │
│  going offline.                             │
└───────────────┬─────────────────────────────┘
                │  firebase-admin SDK
                │  listen → /desired
                │  write  ← /reported
                ▼
┌─────────────────────────────────────────────┐
│  TIER 3 — Desktop bridge (Node.js)          │
│  Runs on a laptop/Pi physically cabled to   │
│  the board. Translates JSON ⇄ serial lines. │
└───────────────┬─────────────────────────────┘
                │  USB serial, 9600 baud, newline-delimited
                ▼
┌─────────────────────────────────────────────┐
│  TIER 4 — Arduino Uno R3                    │
│  DHT11, LDR, ULN2003 + 28BYJ-48 stepper,    │
│  16x2 I2C LCD, tactile override buttons.    │
│  Runs the automation loop autonomously.     │
└─────────────────────────────────────────────┘
```

### The load-bearing architectural decision

**The Arduino runs the automation loop by itself.** It does not ask the cloud what to
do. It holds its own thresholds in EEPROM and decides locally whether to open or
close. Firebase and the bridge exist to *observe* it and to *push new intent* to it —
not to drive it cycle by cycle.

This matters because the bridge is a laptop on a USB cable, and laptops sleep, get
unplugged, and lose Wi-Fi. If automation lived in the cloud, the window would stop
working the moment the laptop closed. Build it so that pulling the USB cable out
changes nothing about whether the blinds respond to heat — it only stops the phone
from seeing it.

### Desired vs reported state

This is the AWS-IoT-shadow pattern and every data flow in the app follows it.

- **`/desired`** — what the user wants. Only the PWA writes here. The bridge listens.
- **`/reported`** — what the hardware actually is. Only the bridge writes here. The
  PWA listens.

The UI renders `reported`, never `desired`. When the two disagree, the UI shows a
transient "Adjusting…" state. This is what makes the app honest: it shows what the
window *is* doing, not what was asked. If the motor jams or the board is unplugged,
the user sees the truth instead of an optimistic lie.

### Latency expectations — be honest in the UI

The original hardware spec asked for sub-200ms command execution. That was written
for a direct USB link. Over Firebase the realistic round trip is **250–800ms** on a
good connection: PWA write → RTDB propagation → bridge listener → serial write →
stepper motion → serial ack → RTDB write → PWA listener.

Do not fake this away with optimistic UI that snaps instantly. Instead:
- Fire the "Adjusting…" state on write, immediately.
- Animate the 3D slats to the *target* position over ~900ms while waiting.
- Reconcile against `reported` when the ack lands.
- If no ack within 5 seconds, show "The window unit isn't responding" and revert the
  dial to the last reported value.

---

## 3. Repository layout

A pnpm workspace monorepo.

```
aperture/
├── package.json                 # workspace root
├── pnpm-workspace.yaml
├── PRD.md                       # this file
├── .env.example
├── apps/
│   ├── web/                     # Tier 1 — Next.js 16 PWA
│   └── bridge/                  # Tier 3 — Node.js desktop bridge
├── firmware/
│   └── aperture/
│       └── aperture.ino         # Tier 4 — Arduino sketch
└── packages/
    └── shared/                  # types + protocol constants, imported by both apps
        ├── src/types.ts
        ├── src/protocol.ts
        └── src/paths.ts
```

`packages/shared` is not optional. The serial protocol and the RTDB schema are a
contract between two separately-running processes; if the shapes are declared twice
they will drift. Declare them once, import them in both.

---

## 4. Firebase Realtime Database schema

Device id is a string, default `"window-01"`, read from env in both apps.

```jsonc
{
  "devices": {
    "window-01": {

      "meta": {
        "name": "Bedroom window",
        "firmware": "2.4.1",
        "createdAt": 1754179200000
      },

      // Written ONLY by the PWA. The bridge listens here.
      "desired": {
        "position": 62,           // 0-100, % open
        "mode": "auto",           // "auto" | "manual"
        "tempLimit": 26,          // °C, 18-35
        "lightLimit": 700,        // lux, 0-1200
        "overrideTimeoutMin": 15, // 1-60
        "updatedAt": 1754179200000
      },

      // Written ONLY by the bridge. The PWA listens here.
      "reported": {
        "position": 62,
        "mode": "auto",
        "tempLimit": 26,
        "lightLimit": 700,
        "temperature": 28.4,      // °C
        "humidity": 64,           // %
        "light": 850,             // lux
        "motorState": "idle",     // "idle" | "moving" | "fault"
        "heatProtection": true,   // closed specifically due to heat+sun
        "overrideEndsAt": null,   // epoch ms, or null when in auto
        "battery": 78,            // %, null if USB-powered
        "updatedAt": 1754179200000
      },

      // Written ONLY by the bridge. Presence heartbeat.
      "connection": {
        "online": true,
        "lastSeen": 1754179200000,
        "serialPort": "/dev/ttyUSB0",
        "bridgeVersion": "1.0.0"
      },

      // Append-only. Written by the bridge. Read by the PWA activity screen.
      "events": {
        "-Nxyz...": {
          "at": 1754179320000,
          "kind": "auto",         // "auto" | "manual" | "alert"
          "position": 20,
          "message": "Closed to 20% — room hit 29°C in direct sun"
        }
      }
    }
  }
}
```

### Rules

Use `onDisconnect()` on `/connection` in the bridge so that if the bridge process
dies or loses network, Firebase itself flips `online` to `false` and stamps
`lastSeen`. Do not try to detect this from the PWA with timeouts — let the server do
it. This is the single most important reliability detail in the whole build.

Cap `/events` at the most recent 100 entries. The bridge trims on write.

Security rules (`database.rules.json`): require auth on everything; allow the PWA's
authenticated user to write `desired` only, and the bridge service account to write
`reported`, `connection`, and `events` only. Never ship with open rules, not even in
development — an open RTDB with a public URL gets found by scanners within days.

---

## 5. Serial protocol (bridge ⇄ Arduino)

Newline-delimited plain text, 9600 baud, 8N1. Human-readable so it can be debugged
in the Arduino Serial Monitor with no tooling.

### Arduino → bridge (telemetry, every 1000ms)

```
STATE T:28.4 H:64 L:850 P:62 M:AUTO MS:IDLE HP:1 B:78
```

| Field | Meaning |
|---|---|
| `T` | temperature °C, one decimal |
| `H` | humidity %, integer |
| `L` | light, raw analog 0–1023 mapped to lux |
| `P` | blind position 0–100 |
| `M` | `AUTO` or `MANUAL` |
| `MS` | motor state `IDLE`, `MOVING`, `FAULT` |
| `HP` | heat protection active, `1` or `0` |
| `B` | battery %, or `-1` when USB-powered |

Event lines, emitted when something notable happens:

```
EVENT AUTO P:20 MSG:Closed to 20 percent - room hit 29C in direct sun
EVENT MANUAL P:100 MSG:Opened by physical button
EVENT ALERT MSG:Stepper stall detected
```

Boot line, emitted once on reset — the bridge uses it to detect a board reset and
re-push desired state:

```
READY FW:2.4.1
```

### Bridge → Arduino (commands)

```
SET P:80              // move to 80% open, implies MANUAL
SET MODE:AUTO         // resume automation now
SET MODE:MANUAL
SET TLIM:26           // temperature threshold °C
SET LLIM:700          // light threshold
SET TIMEOUT:15        // override timeout, minutes
PING                  // Arduino replies PONG
```

Every `SET` is acknowledged:

```
ACK SET P:80
ERR SET P:180 REASON:out_of_range
```

### Protocol rules

- The Arduino ignores any line it does not recognise rather than halting. A garbled
  byte on the wire must never wedge the firmware.
- The bridge validates and clamps every value **before** writing to serial. Never
  trust a number that came from the network to be in range.
- The bridge waits for `ACK` before mirroring the change into `/reported`. Timeout
  2000ms, then retry once, then write an `alert` event.

---

## 6. Tier 4 — Arduino firmware

`firmware/aperture/aperture.ino`

### Hardware

| Component | Connection |
|---|---|
| Arduino Uno R3 | — |
| DHT11 temp/humidity | digital pin 2 |
| LDR light sensor module | analog A0 |
| ULN2003 driver → 28BYJ-48 stepper | digital 8, 9, 10, 11 |
| 16x2 I2C LCD | SDA A4, SCL A5 (address 0x27) |
| Tactile button — open | digital 3 (INPUT_PULLUP) |
| Tactile button — close | digital 4 (INPUT_PULLUP) |
| Tactile button — mode | digital 5 (INPUT_PULLUP) |
| Li-Ion pack + SPDT switch | Vin |

Libraries: `DHT sensor library`, `AccelStepper`, `LiquidCrystal_I2C`, `EEPROM`.

### Requirements

**FR-1.1 — Heat-blocking automation.** If `temperature > tempLimit` AND
`light > lightLimit`, close the blinds. Emit an `EVENT AUTO`.

**FR-1.2 — Optimal-light auto-open.** If `light < lightLimit` AND temperature is
within comfort range, open the blinds. Emit an `EVENT AUTO`.

**FR-1.3 — Local LCD readout.** Continuously render temperature, humidity, light,
and blind state on the 16x2 display. Line 1: `28.4C 64% 850lx`. Line 2:
`AUTO  OPEN 62%`. This must keep working with the USB cable unplugged.

**FR-1.4 — Physical override.** Pressing a tactile button immediately toggles the
motor and switches to `MANUAL`, pausing automation for `overrideTimeoutMin`. After
the timeout the firmware returns to `AUTO` on its own and emits an event. Debounce
all buttons in software, 50ms.

**FR-1.5 — Threshold persistence.** `tempLimit`, `lightLimit`, and
`overrideTimeoutMin` live in EEPROM and survive power loss. On boot, load them; if
the EEPROM magic byte is absent, write defaults (26 / 700 / 15).

**FR-1.6 — Motor coil protection.** De-energise all four ULN2003 output pins the
moment a movement completes. Leaving the coils energised at rest cooks the driver
and drains the battery for no benefit — this is the single most common failure in
28BYJ-48 projects and it must be handled explicitly, not left to the library.

**FR-1.7 — Hysteresis.** Apply a ±1.5°C and ±60 lux dead band around both
thresholds. Without it the blinds will oscillate open/closed for minutes whenever a
reading sits on the boundary, which is both maddening and hard on the motor.

**FR-1.8 — Non-blocking loop.** No `delay()` anywhere in `loop()`. Use `millis()`
scheduling and `AccelStepper`'s non-blocking `run()`. The board must keep reading
serial and buttons while the motor is turning.

**FR-1.9 — Stall detection.** If a commanded move does not complete within the
expected step time plus 50%, stop, set `MS:FAULT`, and emit an `EVENT ALERT`.

---

## 7. Tier 3 — Desktop bridge

`apps/bridge` — a Node.js CLI application. TypeScript, built with `tsup`, run with
`node dist/index.js`.

### Dependencies

`serialport`, `@serialport/parser-readline`, `firebase-admin`, `dotenv`, `zod`,
`pino` + `pino-pretty`, `commander`.

### Responsibilities

1. **Auto-discover the board.** List serial ports, prefer one whose manufacturer
   matches Arduino/CH340/FTDI. Allow override with `--port`. If none found, log
   clearly and retry every 5s rather than exiting.

2. **Parse telemetry.** Read newline-delimited lines, parse `STATE` into a typed
   object, validate with zod, discard malformed lines with a warning.

3. **Throttle writes to Firebase.** The Arduino emits state every second, but
   writing every tick burns quota and bandwidth for no user benefit. Write to
   `/reported` when a value **meaningfully changes** (temperature by ≥0.3°C, light by
   ≥25 lux, humidity by ≥2%, or any change to position/mode/motorState), or at least
   once every 30s as a heartbeat. Debounce 500ms.

4. **Listen to `/desired`.** On change, diff against last known desired, translate
   only the changed fields into `SET` commands, write to serial, await `ACK`.

5. **Presence.** On connect, set `/connection/online = true` and register
   `onDisconnect()` to set it false with a `lastSeen` server timestamp. Heartbeat
   `lastSeen` every 20s.

6. **Events.** Forward `EVENT` lines to `/events` with a push key and server
   timestamp. Trim to the newest 100.

7. **Board reset recovery.** On seeing `READY`, re-push the entire current `/desired`
   state to the board. A reset board has EEPROM thresholds but may have lost mode
   state — reconciling here prevents silent divergence.

8. **Reconnection.** On serial error or port disappearance, close cleanly, mark
   offline, and retry every 5s with backoff. The bridge must survive the cable being
   yanked and replugged without a restart.

### Mock mode

`node dist/index.js --mock` runs with **no hardware attached**, generating plausible
synthetic telemetry: a diurnal light curve, temperature that drifts with light, and
an automation loop that mirrors the firmware logic. It responds to commands from
Firebase exactly as the real board would.

Build this first, before touching any hardware. It lets the entire PWA be developed
and demoed with nothing plugged in, and it's what makes the project presentable if
the board misbehaves five minutes before a demo.

### CLI output

Log a compact live status line so the operator can see it working at a glance:

```
[14:02:31] ● connected  /dev/ttyUSB0   T 28.4°C  H 64%  L 850lx  P 62%  AUTO  idle
```

---

## 8. Tier 1 — PWA

`apps/web` — Next.js 16, App Router, TypeScript strict.

### Stack

- Next.js 16 (App Router, React Server Components where they help; the dashboard is
  client-side because it's realtime)
- shadcn/ui for primitives — Button, Switch, Sheet, Tabs, Skeleton, Sonner toasts
- Tailwind CSS for everything else
- Three.js via `@react-three/fiber` and `@react-three/drei` for the window model
- `firebase` web SDK v10+, Realtime Database only
- `next-pwa` or a hand-rolled service worker + manifest
- `zustand` for client state (small, no boilerplate, works well with a realtime
  subscription feeding it)

### Firebase integration

One subscription module, `lib/firebase/device.ts`, exposing:

```ts
useDevice()          // subscribes to reported + connection, returns typed state
setDesired(patch)    // shallow-merges into /desired with a server timestamp
useEvents(limit)     // subscribes to the newest N events
```

Every mutation goes through `setDesired`. No component writes to Firebase directly.

Handle three connection layers separately and never conflate them:
1. **Browser ↔ Firebase** — the SDK's own `.info/connected`
2. **Bridge ↔ Firebase** — `/connection/online`
3. **Bridge ↔ Arduino** — implied by `reported.updatedAt` freshness

The UI must be able to say "your phone is offline" and "the window unit is offline"
as different sentences, because the fix is different in each case.

### PWA requirements

- `manifest.json` with name, short name, `display: standalone`,
  `theme_color: #FFC42E`, `background_color: #FFF6DC`, and maskable icons at 192 and
  512.
- Service worker: cache the app shell. **Do not cache Firebase RTDB responses** —
  stale telemetry displayed as live is worse than no telemetry.
- Offline screen: show last-known values with an explicit "last updated" stamp and a
  clear offline banner. Never present cached numbers as current.
- Installable on Android and iOS, with `apple-touch-icon` and
  `apple-mobile-web-app-capable`.
- Optimised for portrait mobile first. Safe-area insets respected for notched
  devices.

---

## 9. Design system

The visual design has already been produced in Claude Design. These tokens are
authoritative — implement them as CSS custom properties in `globals.css` and map them
into the Tailwind theme so they're usable as utilities.

### Colour

| Token | Hex | Role |
|---|---|---|
| `--sun` | `#FFC42E` | Active, open, sunny |
| `--ember` | `#F59A0B` | Hover, pressed, arc gradient end |
| `--shade` | `#4A6572` | Closed, cool, shaded |
| `--ink` | `#14110D` | Primary text, dial knobs |
| `--ink-soft` | `#6B6459` | Secondary text, labels, units |
| `--ink-faint` | `#A39C90` | Metadata, timestamps, disabled |
| `--tile` | `#F4F2ED` | Card surfaces |
| `--tile-sunk` | `#E8E5DE` | Inset wells, unfilled dial track |
| `--live` | `#34C77B` | Connection indicator |
| `--alert` | `#E5484D` | Offline, fault, alerts |

**Ambient canvas.** The page background is a gradient that encodes thermal state and
cross-fades over 1200ms when the state changes:

- Heat-gain: `linear-gradient(135deg, #FFF6DC 0%, #FFE9A8 45%, #FFC42E 100%)`
- Comfortable: `linear-gradient(135deg, #EDF2F5 0%, #DCE6EC 45%, #A8BCC9 100%)`

This is a signal, not decoration — the room's thermal condition should be legible
from peripheral vision before a single word is read.

### Typography

A geometric grotesque with characterful numerals. The numbers carry this design, so
avoid Inter and other neutral defaults.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Hero readout | 76–92px | 500 | Dial centres, window overlay. Tracking `-0.04em`, tabular figures |
| Tile readout | 44–52px | 500 | Sensor values. Tracking `-0.03em` |
| Screen title | 20px | 500 | Sentence case |
| Body / status | 14px | 400 | Line height 1.6 |
| Label | 12px | 500 | `--ink-soft` |
| Meta | 12px | 400 | `--ink-faint` |

All copy in sentence case. Never Title Case, never ALL CAPS.

### Shape

- Tiles `border-radius: 28px`; nested elements `20px`; every button, toggle, chip and
  badge is a full pill
- Tile shadow `0 2px 8px rgba(20,17,13,0.04), 0 12px 32px rgba(20,17,13,0.06)`
- Tile padding 24px, grid gap 16px
- The 3D window sits directly on the canvas with a contact shadow, **not** inside a
  tile

### Interaction principles — non-negotiable

**No typed input, ever.** No text fields, no number inputs, no linear sliders
anywhere in the product. Every adjustable value is a circular radial dial. Secondary
controls are pill toggles and segmented pill switches.

**Recognition over recall.** Every control shows its current value, its unit, and a
plain-English state label at all times. Every icon is paired with a text label. Dial
ranges are visible on the arc so "high" needs no explanation.

**The object is the status indicator.** The 3D window is the primary status display.
Text badges confirm; they don't lead.

---

## 10. Components

### RadialDial — the signature component

A 240° arc with the gap at the bottom, starting at 7 o'clock and sweeping clockwise
to 5 o'clock.

Layers, back to front:
1. **Tick ring** — short radial ticks around the arc, `--ink-faint` at 40%; every
   fifth tick longer and darker
2. **Track** — 14px stroke, `--tile-sunk`, round caps
3. **Progress arc** — 14px stroke filled from start to current value; `--sun` →
   `--ember` gradient for warm values, `--shade` for cool/threshold values
4. **Knob** — 30px `--ink` circle with a 10px `--sun` core, draggable, ring shadow
5. **Centre readout** — value at hero size, unit at 14px beneath
6. **End caps** — 12px labels naming the extremes ("Closed"/"Open", "18°"/"35°")

Interaction: drag the knob or tap the arc to jump. Keyboard: arrows step, Home/End
jump. Wrap in `role="slider"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`,
`aria-valuetext`.

Sizes: `lg` 280px (primary), `md` 200px (thresholds), `sm` 56px (ring gauge inside
sensor tiles — arc only, no knob or readout).

Dial changes are **debounced 400ms** before writing to Firebase, so dragging produces
one write rather than fifty.

### WindowObject — the Three.js hero

A window with horizontal venetian slats at a slight three-quarter angle.

```ts
type WindowObjectProps = {
  position: number          // 0-100, drives slat rotation
  lightLevel: number        // 0-1200 lux, drives sun intensity
  thermalState: 'heat-gain' | 'comfortable'
  isMoving: boolean
}
```

- Individual slat meshes rotating on their long axis — a real 3D scene, not a sprite
- One directional light acting as the sun, intensity mapped from `lightLevel`
- Light passing through the slat gaps casts warm striped shadows onto a floor plane
  beneath the window; stripe contrast scales with `lightLevel`
- At `position: 0` slats shut, no light through, cool slate tint
- At `position: 100` slats fully open, strong warm flood
- Slat rotation animates over 900ms `cubic-bezier(0.4, 0, 0.2, 1)` — it's a physical
  motor, it eases, it never snaps
- Hero percentage numeral overlaps the lower-left of the object, breaking its
  bounding box so number and object read as one composition

Performance: cap the device pixel ratio at 2, use `frameloop="demand"` and invalidate
only on state change, and dispose geometries on unmount. This runs on mid-range
Android phones, not workstations. Ship a static SVG fallback for
`prefers-reduced-motion` and for WebGL-unavailable contexts.

### Other components

- **SensorTile** — label with icon, 44–52px numeral with unit, one-word state label
  ("Warm", "Bright", "Moderate"), and a `sm` RadialDial ring gauge showing position
  in range
- **SegmentedPill** — 2–3 segments, active filled `--sun` with sliding indicator,
  always with a plain-text explanation line beneath
- **Toggle** — pill switch, always paired with a 14px label and 12px description
- **StatusBanner** — wide pill, warm or cool tint, icon plus one plain sentence
- **ConnectionChip** — 6px dot plus text, "Live · updated 4s ago" or "Offline · last
  seen 2 min ago"

---

## 11. Screens

### Screen 1 — Control (default)

1. **Top bar** — ConnectionChip left, room name centre, settings icon right
2. **WindowObject hero** — largest element, on the canvas, with the overlapping
   percentage numeral
3. **RadialDial (lg)** — "Blind position", centre reads value with `% open`, end caps
   "Closed"/"Open". Dragging moves the 3D slats live, before the write lands.
4. **SegmentedPill** — "Auto"/"Manual", with explanation beneath: "Auto — blinds
   respond to heat and sunlight" or "Manual — automation resumes in 12:04"
5. **Sensor tile row** — Room temp, Humidity, Sunlight
6. **StatusBanner** — e.g. "Blinds closed to block heat gain — saving cooling energy"

Desktop: two columns, window and dial left, controls and tiles right.

### Screen 2 — Automation

1. Title "Automation rules"
2. **Two RadialDials (md)**, each in its own tile:
   - "Close blinds above" — `26 °C`, amber arc, range 18–35. Helper: "Blinds close
     when the room gets hotter than this."
   - "Sunlight trigger" — `700 lux`, slate arc, range 0–1200. Helper: "Only close
     when sunlight is stronger than this."
3. **Rule preview tile** — the combined rule as a live sentence built from the dial
   values and current readings: "Right now: the room is 28°C and sunlight is 850 lux.
   Both are above your limits, so the blinds are closed." **This sentence updates as
   the dials are dragged.** It is the clearest expression of recognition-over-recall
   in the product — build it carefully. Include a "Reset to defaults" pill.
4. **Toggle rows** — "Resume auto after manual override" (on, "Automation restarts 15
   minutes after you touch the controls"), "Notify when blinds close for heat" (on),
   "Notify if the device goes offline" (off)

### Screen 3 — Activity

1. **Summary tile** — large numeral with "auto adjustments today", plus a thin bar
   showing the proportion of the day the blinds were closed, with a legend
2. **Filter row** — scrolling pills "All", "Auto", "Manual", "Alerts"; filtering works
3. **Timeline** — tiles with a circular icon badge (amber auto, slate manual, red
   alert), plain-language description, relative timestamp, and a tiny window glyph
   showing slat position at that moment
4. **Empty state** — soft line drawing of a shut window, "No activity yet today." and
   a line explaining that events appear once the blinds move

### Screen 4 — Device

1. **Device tile** — controller illustration, device name, firmware version,
   ConnectionChip, "Reconnect" pill
2. **Signal tile** — link quality as a `sm` ring plus plain label, last-sync stamp
3. **Power tile** — battery as a `sm` ring, "Running on battery — 4 hrs remaining" or
   "Powered by USB"
4. **Calibration** — "Re-calibrate blind travel" pill with a line explaining it
   teaches the motor its fully-open and fully-closed limits
5. **Offline banner** — `--alert` tinted: "Can't reach the window unit. The physical
   buttons on the frame still work."

---

## 12. States

Every one of these must be reachable and visually correct.

| State | Behaviour |
|---|---|
| **Heat protection active** | Warm canvas, blinds closed, amber banner, blocked light in the 3D scene |
| **Comfortable / open** | Cool canvas, blinds open, bright flood, "Open — conditions are comfortable" |
| **Manual override** | Mode pill on Manual, live countdown chip "Auto resumes in 12:04", automation dials dimmed but readable |
| **Adjusting** | Slats animating, numeral counting, "Adjusting…" chip near the dial, dial locked |
| **Device offline** | Red ConnectionChip, alert banner, controls disabled **with a stated reason**, last-known values shown with an explicit timestamp |
| **Browser offline** | Distinct banner — "Your phone is offline" — because the fix is different |
| **Motor fault** | Alert banner, "The blind motor is stuck. Try re-calibrating on the device screen." |
| **First run / no device** | Empty state explaining that the desktop bridge needs to be started, with the exact command to run |

---

## 13. Build order

Work in this sequence. Each milestone is independently demonstrable.

**M1 — Workspace and contracts.** Monorepo, `packages/shared` with types, protocol
constants, and RTDB path helpers. Firebase project created, RTDB provisioned,
security rules written and deployed. `.env.example` filled in.

**M2 — Bridge in mock mode.** Full bridge with `--mock`, no hardware. Synthetic
telemetry writing to `/reported`, listening to `/desired`, presence via
`onDisconnect`, event generation. Verify in the Firebase console that data moves both
ways.

**M3 — PWA shell and realtime binding.** Next.js 16 app, design tokens in Tailwind,
shadcn installed, Firebase subscription layer, Screen 1 with real dials wired to the
mock bridge. At the end of M3 you can drag a dial on your phone and watch the mock
bridge react — the whole cloud round trip proven before any hardware exists.

**M4 — Three.js window.** WindowObject with animated slats bound to reported
position, sun intensity from light level, striped shadow casting, reduced-motion
fallback.

**M5 — Remaining screens.** Automation, Activity, Device. All states from §12.

**M6 — PWA polish.** Manifest, service worker, offline handling, install prompt,
icons, safe areas, Lighthouse PWA audit passing.

**M7 — Arduino firmware.** Full sketch with sensors, stepper, LCD, buttons, EEPROM,
hysteresis, non-blocking loop, coil de-energising, stall detection.

**M8 — Hardware integration.** Bridge against the real board. Tune thresholds and
hysteresis against actual sensor noise. This is where reality bites — budget more
time than seems reasonable for sensor noise and stepper calibration.

Building M2 before M7 is deliberate. The mock bridge means the entire software stack
is finished and demoable before the hardware is in the loop, so a misbehaving DHT11
on demo day costs you a sensor reading, not the whole project.

---

## 14. Configuration

`.env.example` — document every variable, commit this file, never commit `.env`.

```bash
# ── Shared ────────────────────────────────────────────
DEVICE_ID=window-01

# ── apps/web (public — these ship to the browser) ─────
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_DEVICE_ID=window-01

# ── apps/bridge (secret — never expose) ───────────────
FIREBASE_DATABASE_URL=
FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json
SERIAL_PORT=              # blank = auto-discover
SERIAL_BAUD=9600
LOG_LEVEL=info
```

Add `service-account.json` and `.env` to `.gitignore` before the first commit. A
leaked Firebase service account key gives full read/write on the database.

---

## 15. Quality floor

- TypeScript strict mode across both apps. No `any` in the shared package.
- Every number that reaches the screen is rounded — no floating-point artefacts in
  a temperature readout.
- Visible keyboard focus on every interactive element; dials fully keyboard-operable
  and correctly announced.
- `prefers-reduced-motion` respected; slat and dial motion shortened to 150ms rather
  than removed, since they carry state.
- Responsive from 360px up. Portrait mobile is the primary target.
- The bridge survives: cable unplug, board reset, network loss, Firebase
  disconnection — each without a process restart.
- The Arduino survives: USB disconnection with no change to automation behaviour.
- Lighthouse PWA audit passes; installable on Android and iOS.

---

## 16. Out of scope

Multi-device support, user accounts beyond a single shared auth, historical charting
and analytics, weather API integration, scheduling by time of day, voice assistant
integration, native mobile builds, OTA firmware updates. Do not build these. Do not
add abstractions in anticipation of them — one device, one window, done well.
