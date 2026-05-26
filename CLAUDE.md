# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

A teaching scene for A-Frame, built to show students its capabilities and limits. Single room with a moody evening atmosphere: moonlight through windows, a placeholder floor lamp inside. The scene is intentionally small so each new A-Frame feature added on top has room to breathe.

## Running the project

```bash
npm install   # first time only
npm run dev   # live-server on http://localhost:3000, auto-reloads on save
```

A-Frame's `look-controls` uses pointer lock, which requires an HTTP origin — opening `index.html` via `file://` won't work.

## Stack

A-Frame 1.5.0 (CDN) + vanilla JS. No bundler, no build step. Three.js 0.158 ships inside A-Frame.

A `useLegacyLights` deprecation warning fires on boot — that's A-Frame's own renderer init against a newer three.js, not user code. Not actionable from this side.

## Architecture

**Entry point:** `index.html` declares the entire scene. `js/main.js` is loaded in `<head>` with `defer` so custom components register before `<a-scene>` initialises.

**Scene structure:**
- `#rig` — body, `wasd-controls` + `room-bounds`
  - `#head` — `look-controls` + `sync-yaw-to-rig`, offset 1.5m up
    - `#camera` — the A-Frame camera
  - `#leftHand` / `#rightHand` — `laser-controls` (auto-loads the right WebXR controller driver per device)
- Room model: `<a-entity gltf-model="#roomModel" rotation="0 90 0" gltf-shadows>`
- `<a-sky>` — dark navy night sky, visible through the windows
- `#moon` — flat-shaded white sphere, positioned along the directional light's ray
- Lights:
  - `<a-light type="ambient">` — cool fill so shadow interiors aren't pure black
  - `<a-light type="directional">` — the "moon" key light, slants in through the windows from -X, casts shadows
  - `#floor-lamp` group — foot/pole/bulb meshes + warm point light (no shadow casting, deliberate)

**Custom components in `js/main.js`:**

- `room-bounds` — tick-based X/Z clamp on the rig. Defaults to a 5m × 6m room.
- `gltf-shadows` — on `model-loaded`, walks the GLB and sets `castShadow`/`receiveShadow` on every mesh, plus `material.shadowSide = THREE.DoubleSide`. The DoubleSide flip is the important bit: the room is non-manifold (walls are single planes), so without it a directional sun hitting the *outside* of a wall would cast no shadow and light would leak straight through.
- `sync-yaw-to-rig` — solves the double-rotation problem: each tick it copies the yaw `look-controls` writes onto `#head` over to `#rig` and zeroes it on the head. Keeps the body facing the look direction without compounding the rotation.

## Asset notes

- `assets/models/Room_blockoutglb.glb` — the active room. Textured, non-manifold, single-layer walls. Windows don't yet have glass meshes.
- `assets/models/AFRAME_TRIAL.glb` — older untextured version, no longer referenced. Safe to delete when confirmed unwanted.
- `grayboxcode.txt` — reference snippet for building the room out of A-Frame primitives. Not used at runtime.

## Axis convention gotcha

Blender's glTF exporter sends **Blender +Y → glTF -Z** (Blender Z-up, -Y forward → glTF Y-up, -Z forward). The room entity also has `rotation="0 90 0"`, which then sends glTF -Z → world -X. So a wall the user thinks of as "facing +Y in Blender" ends up facing **-X in world space**. Confirmed empirically when the first directional-light placement lit the wrong wall.

## Lighting gotcha

Point-light shadows are disabled deliberately. They require a 6-face cubemap shadow pass and the default bias is acne-prone on flat surfaces — early in development this manifested as wavy moiré-like patterns all over the walls. The floor-lamp point light has `castShadow: false` for this reason. If shadows from it are wanted later, expect to tune `shadowBias`, `shadowNormalBias`, and `shadowMapWidth/Height`.
