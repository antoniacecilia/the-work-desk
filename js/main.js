import AFRAME from 'aframe';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

console.log("The Work Desk initialized");

// Clamps the rig's X/Z position so the camera can't walk through the room walls.
// Tick-based rather than physics-based — cheap, but only handles axis-aligned bounds.
AFRAME.registerComponent("room-bounds", {
  schema: {
    halfWidth: { type: "number", default: 2.5 },  // half of 5m
    halfDepth: { type: "number", default: 3.0 },  // half of 6m
    margin:    { type: "number", default: 0.35 }  // body radius so the camera doesn't clip the wall
  },

  tick: function () {
    const pos = this.el.object3D.position;
    const hw = this.data.halfWidth - this.data.margin;
    const hd = this.data.halfDepth - this.data.margin;

    pos.x = THREE.MathUtils.clamp(pos.x, -hw, hw);
    pos.z = THREE.MathUtils.clamp(pos.z, -hd, hd);
  }
});

// Enables shadow casting on every mesh inside a loaded GLB, and forces both
// material.side and material.shadowSide to DoubleSide. The render-side flip lets us see
// single-sided walls/lamp pieces from any angle; the shadow-side flip is what makes them
// cast shadows regardless of which face the light hits — required when the model isn't
// manifold and when faces' normals point away from a nearby light (e.g. the lamp cap
// facing the ceiling while the point light sits below it).
AFRAME.registerComponent("gltf-shadows", {
  schema: {
    receive: { type: "boolean", default: true }
  },

  init: function () {
    this.el.addEventListener("model-loaded", () => this.apply());
  },

  update: function () {
    if (this.el.getObject3D("mesh")) this.apply();
  },

  apply: function () {
    const receive = this.data.receive;
    this.el.object3D.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = receive;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((m) => {
        if (!m) return;
        m.side = THREE.DoubleSide;
        m.shadowSide = THREE.DoubleSide;
        // Force opaque: Blender sometimes exports opaque-looking materials with
        // transparent=true, which silently disables shadow casting in three.js.
        m.transparent = false;
        m.opacity = 1;
      });
    });
  }
});

// Exposes three.js' `light.shadow.normalBias` to A-Frame (the built-in `light` component
// doesn't surface it). normalBias offsets the receiver along its surface normal before the
// depth test, which prevents seam artifacts where the point light's shadow cubemap faces
// meet — a stark square boundary on the ceiling otherwise appears, since PCF kernels
// sampling across face seams produce false-positive shadow hits.
AFRAME.registerComponent("shadow-normal-bias", {
  schema: { default: 0.05 },

  init: function () {
    this.el.addEventListener("loaded", () => this.apply());
  },

  update: function () { this.apply(); },

  apply: function () {
    const light = this.el.components.light && this.el.components.light.light;
    if (light && light.shadow) light.shadow.normalBias = this.data;
  }
});

// UnrealBloom postprocessing — vendored from A-Frame 1.7's official example at
// https://github.com/aframevr/aframe/blob/v1.7.0/examples/showcase/post-processing/bloom.js
// Works in both flat and WebXR rendering modes thanks to A-Frame 1.7's renderer plumbing
// (HalfFloat render targets, multisampling). Uses HDR linear-space thresholding, so the
// `threshold` value (default 1) is in linear units before tone-mapping, not in 0-1 LDR.
AFRAME.registerComponent('bloom', {
  schema: {
    enabled: { type: 'boolean', default: true },
    threshold: { type: 'number', default: 1 },
    strength: { type: 'number', default: 0.5 },
    radius: { type: 'number', default: 1 }
  },
  events: {
    rendererresize: function () {
      this.renderer.getSize(this.size);
      this.composer.setSize(this.size.width, this.size.height);
    }
  },
  init: function () {
    this.size = new THREE.Vector2();
    this.scene = this.el.object3D;
    this.renderer = this.el.renderer;
    this.camera = this.el.camera;
    this.originalRender = this.el.renderer.render;
    this.bind();
  },
  update: function (oldData) {
    if (oldData.enabled === false && this.data.enabled === true) {
      this.bind();
    }

    if (oldData.enabled === true && this.data.enabled === false) {
      this.el.renderer.render = this.originalRender;
    }

    if (this.composer) {
      this.composer.dispose();
    }
    // create composer with multisampling to avoid aliasing
    var resolution = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    var renderTarget = new THREE.WebGLRenderTarget(
      resolution.width,
      resolution.height,
      { type: THREE.HalfFloatType, samples: 8 }
    );

    this.composer = new EffectComposer(this.renderer, renderTarget);

    // create render pass
    var renderScene = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderScene);

    // create bloom pass
    var strength = this.data.strength;
    var radius = this.data.radius;
    var threshold = this.data.threshold;
    if (this.bloomPass) {
      this.bloomPass.dispose();
    }
    this.bloomPass = new UnrealBloomPass(
      resolution,
      strength,
      radius,
      threshold
    );
    this.composer.addPass(this.bloomPass);

    // create output pass
    if (this.outputPass) {
      this.outputPass.dispose();
    }
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  },

  bind: function () {
    var self = this;
    var isInsideComposerRender = false;

    this.el.renderer.render = function () {
      if (isInsideComposerRender) {
        self.originalRender.apply(this, arguments);
      } else {
        isInsideComposerRender = true;
        self.composer.render(self.el.sceneEl.delta / 1000);
        isInsideComposerRender = false;
      }
    };
  },

  remove: function () {
    this.el.renderer.render = this.originalRender;
    this.bloomPass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
  }
});

// VR smooth locomotion: the left thumbstick translates #rig along the floor plane, in the
// direction the headset is facing (gaze-relative, not controller-relative). Attached to the
// hand that emits `thumbstickmoved`. Only acts in VR; desktop walking stays on wasd-controls.
// `thumbstickmoved` fires on value change, so we cache x/y and integrate every tick — a held
// stick keeps moving without further events until it changes or recentres.
AFRAME.registerComponent("thumbstick-locomotion", {
  schema: {
    speed: { type: "number", default: 1.5 },        // metres per second
    rig:   { type: "selector", default: "#rig" }
  },

  init: function () {
    this.x = 0;
    this.y = 0;
    this._fwd   = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move  = new THREE.Vector3();
    this._up    = new THREE.Vector3(0, 1, 0);
    this.onThumbstick = this.onThumbstick.bind(this);
    this.el.addEventListener("thumbstickmoved", this.onThumbstick);
  },

  onThumbstick: function (evt) {
    this.x = evt.detail.x;
    this.y = evt.detail.y;
  },

  tick: function (time, delta) {
    if (!this.el.sceneEl.is("vr-mode")) return;
    if (Math.abs(this.x) < 0.05 && Math.abs(this.y) < 0.05) return;

    // Gaze direction from the active (XR) camera, flattened to the horizontal plane.
    const cam = this.el.sceneEl.camera;
    cam.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    if (this._fwd.lengthSq() < 1e-6) return;   // looking straight up/down: no usable heading
    this._fwd.normalize();
    this._right.crossVectors(this._fwd, this._up).normalize();

    // Stick convention: pushing forward gives y < 0; pushing right gives x > 0.
    this._move.set(0, 0, 0);
    this._move.addScaledVector(this._fwd, -this.y);
    this._move.addScaledVector(this._right, this.x);
    if (this._move.lengthSq() > 1) this._move.normalize();  // don't let diagonals go faster

    const dist = this.data.speed * (delta / 1000);
    this.data.rig.object3D.position.addScaledVector(this._move, dist);
  },

  remove: function () {
    this.el.removeEventListener("thumbstickmoved", this.onThumbstick);
  }
});

// VR snap turn: the right thumbstick rotates #rig in fixed increments. Snap (vs. smooth)
// turning is the comfort default — discrete jumps avoid the continuous peripheral motion
// (vection) that triggers motion sickness. Debounced via `armed`: the stick must fall back
// near centre before another snap can fire, so one flick = one turn.
AFRAME.registerComponent("snap-turn", {
  schema: {
    rig:       { type: "selector", default: "#rig" },
    angle:     { type: "number", default: 45 },
    threshold: { type: "number", default: 0.7 },
    reset:     { type: "number", default: 0.3 }
  },

  init: function () {
    this.armed = true;
    this.onThumbstick = this.onThumbstick.bind(this);
    this.el.addEventListener("thumbstickmoved", this.onThumbstick);
  },

  onThumbstick: function (evt) {
    if (!this.el.sceneEl.is("vr-mode")) return;
    const x = evt.detail.x;
    if (this.armed && Math.abs(x) > this.data.threshold) {
      const dir = x > 0 ? -1 : 1;  // push right → clockwise → negative yaw in three.js
      this.data.rig.object3D.rotation.y += THREE.MathUtils.degToRad(this.data.angle) * dir;
      this.armed = false;
    } else if (Math.abs(x) < this.data.reset) {
      this.armed = true;
    }
  },

  remove: function () {
    this.el.removeEventListener("thumbstickmoved", this.onThumbstick);
  }
});

// Pauses the named sibling components for the duration of an immersive session and restores
// them on exit. Used to hand control to the headset: wasd-controls and look-controls are
// desktop input methods that should not run against the live XR pose.
AFRAME.registerComponent("pause-in-vr", {
  schema: { type: "array" },

  init: function () {
    const scene = this.el.sceneEl;
    this.onEnter = () => this.data.forEach((name) => {
      const c = this.el.components[name];
      if (c) c.pause();
    });
    this.onExit = () => this.data.forEach((name) => {
      const c = this.el.components[name];
      if (c) c.play();
    });
    scene.addEventListener("enter-vr", this.onEnter);
    scene.addEventListener("exit-vr", this.onExit);
  },

  remove: function () {
    const scene = this.el.sceneEl;
    scene.removeEventListener("enter-vr", this.onEnter);
    scene.removeEventListener("exit-vr", this.onExit);
  }
});

// TEMP DEBUG: a heads-up panel locked in front of the camera, reporting the VR input chain
// so we can diagnose locomotion in-headset (no access to the Quest console). Remove once
// movement is confirmed working. Reports: VR state, controller connection, whether thumbstick
// events fire at all, the latest stick values, and the live rig position.
AFRAME.registerComponent("vr-debug-hud", {
  init: function () {
    const bg = document.createElement("a-entity");
    bg.setAttribute("geometry", "primitive: plane; width: 0.8; height: 0.5");
    bg.setAttribute("material", "color: #000; opacity: 0.78; shader: flat; side: double");
    bg.setAttribute("position", "0 0 -1");
    const txt = document.createElement("a-entity");
    txt.setAttribute("text", "value: starting…; align: center; width: 0.75; color: #2cff7a; baseline: center; wrapCount: 30");
    txt.setAttribute("position", "0 0 0.01");
    bg.appendChild(txt);
    this.el.appendChild(bg);
    this.txt = txt;

    this.evtCount = 0;
    this.lx = this.ly = this.rx = 0;
    this.lConn = this.rConn = false;

    const wire = (sel, isLeft) => {
      const h = document.querySelector(sel);
      if (!h) return;
      h.addEventListener("thumbstickmoved", (e) => {
        this.evtCount++;
        if (isLeft) { this.lx = e.detail.x; this.ly = e.detail.y; }
        else { this.rx = e.detail.x; }
      });
      h.addEventListener("controllerconnected", () => { isLeft ? this.lConn = true : this.rConn = true; });
      h.addEventListener("controllerdisconnected", () => { isLeft ? this.lConn = false : this.rConn = false; });
    };
    wire("#leftHand", true);
    wire("#rightHand", false);
  },

  tick: function (time) {
    if (!this.txt) return;
    if (time - (this._last || 0) < 200) return;
    this._last = time;
    const rig = document.querySelector("#rig").object3D.position;
    this.txt.setAttribute("text", "value",
      "vr-mode: " + this.el.sceneEl.is("vr-mode") + "\n" +
      "ctrl L/R: " + this.lConn + " / " + this.rConn + "\n" +
      "stick evts: " + this.evtCount + "\n" +
      "L x/y: " + this.lx.toFixed(2) + " / " + this.ly.toFixed(2) + "\n" +
      "R x: " + this.rx.toFixed(2) + "\n" +
      "rig x/z: " + rig.x.toFixed(2) + " / " + rig.z.toFixed(2)
    );
  }
});

// Solves the "double rotation" trap with nested rigs:
// look-controls writes yaw + pitch onto #head. If we left the yaw there, the
// child camera would rotate, but the rig body (which owns wasd-controls) would
// keep facing its original direction — so "W" would move you sideways relative
// to where you're looking. We transfer yaw to the rig each tick and zero it on
// the head, keeping pitch on the head where it belongs.
//
// In VR this must NOT run: the headset owns head pose, and snap-turn owns rig yaw.
// We also clear any desktop-applied head rotation on enter-vr so a stale mouse-look
// pitch doesn't tilt the XR view.
AFRAME.registerComponent("sync-yaw-to-rig", {
  init: function () {
    this.rigObj  = document.querySelector("#rig").object3D;
    this.headObj = this.el.object3D;
    this.el.sceneEl.addEventListener("enter-vr", () => {
      this.headObj.rotation.set(0, 0, 0);
    });
  },

  tick: function () {
    if (this.el.sceneEl.is("vr-mode")) return;

    const yaw = this.headObj.rotation.y;

    this.rigObj.rotation.y = yaw;
    this.headObj.rotation.y = 0;

    // Keep the rig perfectly upright — look-controls only writes Y, but be defensive.
    this.rigObj.rotation.x = 0;
    this.rigObj.rotation.z = 0;
  }
});
