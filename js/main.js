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

// Enables shadow casting/receiving on every mesh inside a loaded GLB, and forces
// material.shadowSide = DoubleSide so single-sided ("plane-thin") walls cast shadows
// regardless of which face the light hits — required when the model isn't manifold.
AFRAME.registerComponent("gltf-shadows", {
  init: function () {
    this.el.addEventListener("model-loaded", () => {
      this.el.object3D.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach((m) => { if (m) m.shadowSide = THREE.DoubleSide; });
      });
    });
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
