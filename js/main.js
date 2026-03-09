console.log("The Work Desk initialized");
AFRAME.registerComponent("room-bounds", {
  schema: {
    halfWidth: { type: "number", default: 2.5 },  // half of 5m
    halfDepth: { type: "number", default: 3.0 },  // half of 6m
    margin: { type: "number", default: 0.35 }
  },

  tick: function () {
    const pos = this.el.object3D.position;
    const hw = this.data.halfWidth - this.data.margin;
    const hd = this.data.halfDepth - this.data.margin;

    // Clamp X/Z inside the room
    if (pos.x < -hw) pos.x = -hw;
    if (pos.x > hw) pos.x = hw;

    if (pos.z < -hd) pos.z = -hd;
    if (pos.z > hd) pos.z = hd;
  }
});
AFRAME.registerComponent("sync-yaw-to-rig", {
  init: function () {
    this.rigEl = document.querySelector("#rig");
    this.rigObj = this.rigEl.object3D;
    this.headObj = this.el.object3D;
  },

  tick: function () {
    // headObj.rotation is local (radians). look-controls writes yaw + pitch here.
    const yaw = this.headObj.rotation.y;

    // Move yaw to the rig (body facing direction)
    this.rigObj.rotation.y = yaw;

    // Remove yaw from head so it doesn't double-rotate as a child of the rig
    this.headObj.rotation.y = 0;

    // Optional: keep rig perfectly upright
    this.rigObj.rotation.x = 0;
    this.rigObj.rotation.z = 0;
  }
});
