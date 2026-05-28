# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

A teaching scene for A-Frame, built to show students its capabilities and limits. A single room with a moody evening atmosphere: moonlight through the windows, and a rice-paper orb pendant lamp glowing warmly from the ceiling. The scene is intentionally small so each new A-Frame feature added on top has room to breathe. It is WebXR-first — everything must work in immersive VR, not just on desktop.

## Running the project

```bash
npm install   # first time only
npm run dev   # live-server on http://localhost:3000, auto-reloads on save
```

`live-server` is **desktop-only**. `look-controls` uses pointer lock (needs an HTTP origin, so `file://` won't work), and WebXR needs HTTPS — which `live-server` doesn't provide.

### VR testing & deployment

VR is tested on the live GitHub Pages deployment, **not** locally — the Meta Quest browser refuses plain-HTTP LAN loads and WebXR requires HTTPS.

- Repo: `github.com/antoniacecilia/the-work-desk`, `origin` remote, branch `master`.
- Live: **https://antoniacecilia.github.io/the-work-desk/** — push to `master` auto-deploys (~30–60 s).
- The Quest browser caches hard: if a pushed change "doesn't work," suspect stale cache first (close/reopen the tab).

## Stack

A-Frame **1.7.0** + super-three **0.173.4**, loaded as **ES modules via an importmap** (not a plain CDN `<script>`). Vanilla JS, no bundler, no build step. `js/main.js` is an ES module (`import AFRAME from 'aframe'`).

The importmap (first thing in `<head>`) maps `aframe`, `three`, and `three/addons/`. This is the A-Frame-recommended setup since 1.7's post-processing landed: it lets user-space modules import three.js postprocessing addons that share A-Frame's bundled THREE instance.

## Architecture

**Entry point:** `index.html` declares the entire scene. `js/main.js` (ES module) registers all custom components before `<a-scene>` initialises.

**Scene-level:** `<a-scene renderer="colorManagement: true; toneMapping: ACESFilmic" shadow="type: pcfsoft" bloom="...">`

**Scene structure:**
- `#rig` — body: `wasd-controls`, `room-bounds`, `pause-in-vr="wasd-controls"`
  - `#head` — offset 1.5 m up: `look-controls`, `sync-yaw-to-rig`, `pause-in-vr="look-controls"`
    - `#camera` — the A-Frame camera
  - `#leftHand` — `laser-controls` + `thumbstick-locomotion` (smooth move)
  - `#rightHand` — `laser-controls` + `snap-turn` (45° snap)
- Room model: `<a-entity gltf-model="#roomModel" rotation="0 90 0" gltf-shadows>`
- Lamp model: `<a-entity gltf-model="#lampModel" gltf-shadows="receive: false">` — stem + dome cap, flush to ceiling
- `#lamp-orb` group at `y=2.46967`:
  - paper-orb sphere (radius 0.375, dark base + warm emissive, translucent, `shadow: cast:false receive:false`)
  - bulb sphere (radius 0.1, bright emissive — the visible "source")
  - point light (the lamp's warm light, **casts shadows** — see Lighting)
- `<a-sky>` — dark navy night sky, visible through the windows
- `#moon` — emissive sphere (standard shader, black base + white emissive) positioned along the directional light's ray; blooms through the windows
- Lights:
  - `<a-light type="ambient">` — cool fill so shadow interiors aren't pure black
  - `<a-light type="directional">` — the "moon" key light, slants in through the windows from -X, casts shadows
  - the point light inside `#lamp-orb` (above)

**Custom components in `js/main.js`:**

- `room-bounds` — tick-based X/Z clamp on the rig. Defaults to a 5 m × 6 m room.
- `gltf-shadows` — on `model-loaded`, walks the GLB: sets `castShadow=true`, `receiveShadow` (schema `receive`, default true), and forces `material.side` + `material.shadowSide` to `DoubleSide` and `transparent=false`. The DoubleSide flip matters because the room is non-manifold (single-plane walls) — without it a light hitting the *outside* of a wall casts no shadow and light leaks through. Forcing opaque guards against Blender exporting opaque-looking materials with `transparent=true` (which silently disables shadow casting).
- `shadow-normal-bias` — exposes three.js' `light.shadow.normalBias` (A-Frame's `light` component doesn't surface it). Used on the point light to kill cubemap-seam shadow artifacts.
- `bloom` — UnrealBloom postprocessing, vendored from A-Frame 1.7's official example. Hijacks `renderer.render` to route through an EffectComposer; works in flat **and** immersive modes.
- `thumbstick-locomotion` — left-stick smooth locomotion of the rig, gaze-relative. No-op outside VR.
- `snap-turn` — right-stick 45° debounced snap turns. No-op outside VR.
- `pause-in-vr` — pauses the named sibling components (desktop input) for the duration of an immersive session, restores on exit.
- `sync-yaw-to-rig` — solves the double-rotation trap on desktop: copies the yaw `look-controls` writes onto `#head` over to `#rig`, zeroing it on the head, so the body faces the look direction without compounding rotation. **Skips its tick in VR** (headset owns head pose, `snap-turn` owns rig yaw) and clears stale head rotation on `enter-vr`.

## VR / WebXR notes

- Locomotion is **smooth move (left stick) + snap turn (right stick)** — the comfort default; smooth turning causes motion sickness for many.
- In VR, desktop input is handed to the headset: `wasd-controls` and `look-controls` are paused via `pause-in-vr`, and `sync-yaw-to-rig` goes dormant.
- `thumbstickmoved` events only fire from the Quest controllers inside an active immersive session — there is genuinely nothing to test outside VR. Validate on the deployed URL.

## Postprocessing / bloom

- Renderer uses `toneMapping: ACESFilmic`. The bloom `threshold` is in **linear HDR units before tone-mapping** — only pixels with linear values >1 bloom. Plain hex colours (max 1.0/channel) will **not** bloom; you need `emissiveIntensity > 1`. This is why the moon and bulb use bright emissive on dark/standard materials, and why `shader: flat` (MeshBasicMaterial, no emissive support) won't work for a glowing object.
- Bloom over-brightens easily. If a glowing surface washes out, suspect that direct lighting is saturating it (then bloom catches it): darken the base colour so only the emissive contributes to HDR.

## Asset notes

- `assets/models/Room_blockoutglb.glb` — the active room. Textured, non-manifold, single-layer walls. Windows have no glass meshes yet.
- `assets/models/Lamp_blockoutglb.glb` — the active pendant lamp (stem + dome cap). One mesh, material `Black_M`, opaque. **Cap normals point up** (toward the ceiling, away from the point light below) — relevant to shadows (see below).
- `assets/models/AFRAME_TRIAL.glb` — older untextured version, no longer referenced. Safe to delete when confirmed unwanted.
- `grayboxcode.txt` — reference snippet for building the room out of A-Frame primitives. Not used at runtime.

## Axis convention gotcha

Blender's glTF exporter sends **Blender +Y → glTF -Z** (Blender Z-up, -Y forward → glTF Y-up, -Z forward). The room entity also has `rotation="0 90 0"`, which then sends glTF -Z → world -X. So a wall the user thinks of as "facing +Y in Blender" ends up facing **-X in world space**. Confirmed empirically when the first directional-light placement lit the wrong wall.

## Lighting gotcha — point-light shadows ARE enabled (hard-won)

The lamp's point light casts shadows. This is fiddly because three.js point-light shadows use a 6-face cubemap and are **scale-sensitive**. The settings on the point light are load-bearing:

- **`shadowCameraNear: 0.1; shadowCameraFar: 8`** — the defaults (0.5 / 500) normalise the cap-vs-ceiling depth gap to a number smaller than the bias, silently erasing the shadow. Always scale near/far to the actual scene.
- **`shadowBias: -0.003`** — too small → acne/moiré on the ceiling; too large → the cap shadow disappears.
- **`shadow-normal-bias="0.05"`** — kills the square artifact at cubemap face seams (PCF kernels crossing a seam false-positive).
- **The lamp model uses `gltf-shadows="receive: false"`** — `normalBias` offsets receivers along their surface normal, and the cap's normals point *up, away from the light below*, so the offset made the cap self-shadow. The fixture doesn't need to receive shadows anyway, so it opts out.
- **`shadowRadius: 6`** — softens the edge.

Historical note: in the previous (1.5) iteration these shadows were disabled because of moiré on flat surfaces. The fixes above (scaled shadow camera + bias + normalBias) are what made them viable.
