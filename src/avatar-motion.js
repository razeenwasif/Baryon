import * as THREE from 'three';

const euler = new THREE.Euler();
const rotation = new THREE.Quaternion();
const clamp = THREE.MathUtils.clamp;

// Pose targets use the normalized VRM skeleton; the original rig and spring bones
// are updated by VRM.update after this layer. Every frame starts from a target,
// so breathing and gestures never accumulate rotation drift.
export class AvatarMotion {
  constructor(vrm) {
    this.vrm = vrm;
    this.bones = Object.fromEntries(Object.entries(vrm.humanoid.normalizedHumanBones).map(([name, bone]) => [name, bone.node]));
    vrm.humanoid.resetNormalizedPose();
    this.rest = this.capture();
    this.time = 0; this.activity = 'idle'; this.pose = 'crossed';
    this.waveUntil = 0; this.nextBlink = 2 + Math.random() * 3; this.blinkStart = -10;
    this.pointer = { x: 0, y: 0, until: 0 };
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || { matches: false };
    this.poses = {};
    this.makePoses();
    this.restore(this.poses.crossed);
  }
  capture() { return Object.fromEntries(Object.entries(this.bones).map(([name, node]) => [name, node.quaternion.clone()])); }
  restore(pose) { for (const [name, q] of Object.entries(pose)) this.bones[name]?.quaternion.copy(q); }
  turn(name, x = 0, y = 0, z = 0) { this.bones[name]?.quaternion.copy(this.rest[name]).multiply(rotation.setFromEuler(euler.set(x, y, z))); }
  setPose(pose) { if (pose === 'relaxed' || pose === 'crossed') this.pose = pose; }
  setActivity(activity) { this.activity = activity; }
  wave() { this.waveUntil = this.time + 3.2; }
  look(x, y) { this.pointer = { x: clamp(x, -1, 1), y: clamp(y, -1, 1), until: this.time + 2.5 }; }

  // Two-bone IK, with an elbow pole, keeps the crossed hands in front of the
  // chest and scales the pose to the avatar's own arm lengths.
  aimArm(side, target, pole, handDirection) {
    const upper = this.bones[`${side}UpperArm`], lower = this.bones[`${side}LowerArm`], hand = this.bones[`${side}Hand`];
    if (!upper || !lower || !hand) return;
    const root = this.vrm.humanoid.normalizedHumanBonesRoot;
    root.updateWorldMatrix(true, true);
    target = root.localToWorld(target.clone()); pole = root.localToWorld(pole.clone());
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const elbow = lower.getWorldPosition(new THREE.Vector3()), wrist = hand.getWorldPosition(new THREE.Vector3());
    const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(wrist);
    const direction = target.clone().sub(shoulder);
    const distance = clamp(direction.length(), Math.abs(a - b) + .0001, a + b - .0001);
    direction.normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, a * a - along * along));
    const bend = pole.sub(shoulder); bend.addScaledVector(direction, -bend.dot(direction)).normalize();
    const desiredElbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(bend, height);
    const desiredHand = shoulder.clone().addScaledVector(direction, distance);
    const aim = (node, localDirection, worldDirection) => {
      const parentRotation = node.parent.getWorldQuaternion(new THREE.Quaternion());
      const worldRotation = new THREE.Quaternion().setFromUnitVectors(localDirection.clone().normalize(), worldDirection.normalize());
      node.quaternion.copy(parentRotation.invert().multiply(worldRotation));
      node.updateWorldMatrix(false, true);
    };
    aim(upper, lower.position, desiredElbow.sub(shoulder));
    aim(lower, hand.position, desiredHand.sub(lower.getWorldPosition(new THREE.Vector3())));
    const sign = Math.sign(lower.position.x) || 1;
    const worldHandDirection = handDirection.clone().applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    aim(hand, new THREE.Vector3(sign, 0, 0), worldHandDirection);
  }
  makePoses() {
    this.restore(this.rest);
    this.turn('leftUpperArm', 0, 0, -1.30); this.turn('rightUpperArm', 0, 0, 1.30);
    this.turn('leftLowerArm', 0, -.12, -.08); this.turn('rightLowerArm', 0, .12, .08);
    for (const side of ['left', 'right']) for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
      const sign = side === 'left' ? -1 : 1;
      this.turn(`${side}${finger}Proximal`, 0, 0, sign * .16);
      this.turn(`${side}${finger}Intermediate`, 0, 0, sign * .23);
    }
    this.poses.relaxed = this.capture();
    const root = this.vrm.humanoid.normalizedHumanBonesRoot;
    this.restore(this.rest); root.updateWorldMatrix(true, true);
    const shoulder = this.bones.leftUpperArm, elbow = this.bones.leftLowerArm, hand = this.bones.leftHand;
    if (shoulder && elbow && hand) {
      const origin = root.worldToLocal(shoulder.getWorldPosition(new THREE.Vector3()));
      const scale = (elbow.position.length() + hand.position.length()) / .426;
      const front = this.vrm.meta?.metaVersion === '0' ? -1 : 1;
      for (const side of ['left', 'right']) {
        const node = this.bones[`${side}UpperArm`]; if (!node) continue;
        const sign = Math.sign(root.worldToLocal(node.getWorldPosition(new THREE.Vector3())).x) || 1;
        const top = side === 'left';
        this.aimArm(side,
          new THREE.Vector3(-sign * .075 * scale, origin.y - (top ? .135 : .180) * scale, origin.z + (top ? .215 : .24) * scale * front),
          new THREE.Vector3(sign * .23 * scale, origin.y - .25 * scale, origin.z + .09 * scale * front),
          new THREE.Vector3(-sign * .35, .35, -front));
        this.bones[`${side}Hand`]?.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), side === 'left' ? -1.8 : -1.35));
      }
    }
    this.poses.crossed = this.capture();
    // Keep the fingers softly curled instead of leaving them in the export T-pose.
    for (const name of Object.keys(this.poses.crossed)) if (/Index|Middle|Ring|Little/.test(name)) {
      const sign = name.startsWith('left') ? -1 : 1;
      const curl = name.endsWith('Proximal') ? .38 : name.endsWith('Intermediate') ? .48 : .18;
      this.poses.crossed[name].copy(this.rest[name]).multiply(new THREE.Quaternion().setFromEuler(euler.set(0, 0, sign * curl)));
    }
    this.restore(this.poses.relaxed);
    this.turn('rightUpperArm', 0, -.12, 1.10);
    this.turn('rightLowerArm', 0, 0, -2.72);
    this.turn('rightHand', 1.4, 0, -.12);
    this.poses.wave = this.capture();
    this.restore(this.rest);
  }
  update(dt, mouth = 0) {
    this.time += dt;
    const t = this.time, reduced = this.reducedMotion.matches;
    const waving = t < this.waveUntil;
    const base = waving ? this.poses.wave : this.poses[this.pose];
    const blend = 1 - Math.exp(-dt * 6);
    const targets = { ...base };
    // Use target quaternions, rather than adding offsets to last frame's rotation.
    const offset = (name, x, y, z) => {
      const node = this.bones[name]; if (!node) return;
      targets[name] = base[name].clone().multiply(new THREE.Quaternion().setFromEuler(euler.set(x, y, z)));
    };
    const breath = reduced ? 0 : Math.sin(t * 1.55);
    offset('chest', breath * .014, 0, 0);
    offset('spine', 0, reduced ? 0 : Math.sin(t * .55) * .014, reduced ? 0 : Math.sin(t * .72) * .012);
    let pitch = reduced ? 0 : Math.sin(t * .83) * .018, yaw = 0, tilt = 0;
    if (!reduced && t < this.pointer.until) { yaw = this.pointer.x * .10; pitch += this.pointer.y * .065; }
    if (this.activity === 'listening') { tilt = .09; pitch -= .035; }
    if (this.activity === 'thinking') { tilt = -.075; yaw += .07; pitch -= .035; }
    if (this.activity === 'speaking' && !reduced) { pitch += Math.sin(t * 3.4) * .04 * (.35 + mouth); tilt += Math.sin(t * 1.5) * .025; }
    offset('neck', pitch, yaw, tilt);
    if (this.activity === 'speaking' && this.pose === 'relaxed' && !waving && !reduced) {
      offset('rightLowerArm', -.08, .10, .12 + Math.sin(t * 2.2) * .10);
      offset('leftLowerArm', -.04, -.08, -.08 - Math.sin(t * 1.8) * .06);
    }
    if (waving && !reduced) offset('rightHand', 0, Math.sin(t * 8) * .18, Math.sin(t * 8) * .24);
    for (const [name, node] of Object.entries(this.bones)) node.quaternion.slerp(targets[name], blend);
    if (t >= this.nextBlink) { this.blinkStart = t; this.nextBlink = t + 3 + Math.random() * 4; }
    const phase = (t - this.blinkStart) / .18;
    const expressions = this.vrm.expressionManager;
    expressions?.setValue('blink', phase >= 0 && phase < 1 ? Math.sin(phase * Math.PI) : 0);
    expressions?.setValue('aa', mouth);
    for (const [name, target] of [['relaxed', .12], ['happy', waving ? .25 : this.activity === 'speaking' ? .10 : .025]]) {
      const current = expressions?.getValue(name) || 0;
      expressions?.setValue(name, THREE.MathUtils.lerp(current, target, blend));
    }
  }
}
