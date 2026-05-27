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

// Solves the "double rotation" trap with nested rigs:
// look-controls writes yaw + pitch onto #head. If we left the yaw there, the
// child camera would rotate, but the rig body (which owns wasd-controls) would
// keep facing its original direction — so "W" would move you sideways relative
// to where you're looking. We transfer yaw to the rig each tick and zero it on
// the head, keeping pitch on the head where it belongs.
AFRAME.registerComponent("sync-yaw-to-rig", {
  init: function () {
    this.rigObj  = document.querySelector("#rig").object3D;
    this.headObj = this.el.object3D;
  },

  tick: function () {
    const yaw = this.headObj.rotation.y;

    this.rigObj.rotation.y = yaw;
    this.headObj.rotation.y = 0;

    // Keep the rig perfectly upright — look-controls only writes Y, but be defensive.
    this.rigObj.rotation.x = 0;
    this.rigObj.rotation.z = 0;
  }
});
