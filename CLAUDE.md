# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Project

No build system — open `index.html` directly in a browser, or serve it with any static file server:

```bash
npx serve .
# or
python -m http.server
```

A-Frame's pointer lock (used by `look-controls`) requires a server origin (not `file://`).

## Architecture

**Stack:** A-Frame 1.5.0 (CDN) + vanilla JS. No npm, no bundler, no build step.

**Entry point:** `index.html` declares the entire A-Frame scene. `js/main.js` is loaded at the bottom of `<body>` and registers custom components before the scene fully initializes.

**Scene structure:**
- `#rig` — camera rig entity at world position, carries WASD movement and `room-bounds` component
  - `#head` — offset 1.5m up, carries `look-controls` and `sync-yaw-to-rig`
    - `#camera` — actual A-Frame camera

**Custom components in `js/main.js`:**

- `room-bounds` — tick-based position clamper. Constrains the rig's X/Z to within `halfWidth`/`halfDepth` minus a `margin`. Default room: 5m × 6m.
- `sync-yaw-to-rig` — solves the nested-entity double-rotation problem: each tick it reads the yaw from `look-controls` on `#head`, transfers it to `#rig`, and zeroes it on `#head`. This keeps the rig body facing the look direction while preventing compound rotation.

**3D model:** `assets/models/AFRAME_TRIAL.glb` is the room geometry. It's loaded via `<a-asset-item>` and rendered rotated 90° on Y.

**`grayboxcode.txt`** is a reference snippet for building the room out of A-Frame primitives (floor/ceiling/walls) — not currently used in the scene.
