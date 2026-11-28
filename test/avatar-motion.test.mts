import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AvatarMotion } from '../src/avatar-motion.js';

type BoneMap = Record<string, { node: THREE.Object3D }>;

function rig() {
  const root = new THREE.Object3D(), bones: BoneMap = {};
  function add(name: string, parent: string | null, position: [number, number, number]) {
    const node = new THREE.Object3D(); node.position.fromArray(position);
    (parent ? bones[parent]?.node || root : root).add(node); bones[name] = { node };
  }
  add('hips', null, [0, .95, 0]); add('spine', 'hips', [0, .1, 0]);
  add('chest', 'spine', [0, .1, 0]); add('neck', 'chest', [0, .2, 0]);
  for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
    add(`${side}UpperArm`, 'chest', [sign * .09, .165, -.026]);
    add(`${side}LowerArm`, `${side}UpperArm`, [sign * .22, 0, 0]);
    add(`${side}Hand`, `${side}LowerArm`, [sign * .206, 0, 0]);
  }
  const vrm = {
    meta: { metaVersion: '1' },
    humanoid: {
      normalizedHumanBones: bones,
      normalizedHumanBonesRoot: root,
      resetNormalizedPose() { Object.values(bones).forEach(({ node }) => node.quaternion.identity()); },
    },
  };
  return { motion: new AvatarMotion(vrm as unknown as ConstructorParameters<typeof AvatarMotion>[0]), bones, root };
}
const position = (node: THREE.Object3D) => node.getWorldPosition(new THREE.Vector3());

test('crossed wrists reach opposite sides in front of the torso on unequal upper/lower arm lengths', () => {
  const { motion, bones } = rig(); motion.restore(motion.poses.crossed!);
  for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
    const wrist = position(bones[`${side}Hand`].node), shoulder = position(bones[`${side}UpperArm`].node);
    assert.ok(wrist.x * sign < 0, 'hand crosses the torso');
    assert.ok(wrist.z > shoulder.z + .15, 'hand stays in front of the torso');
    assert.ok(wrist.y < shoulder.y, 'arms rest below shoulders');
  }
});

test('wave raises the hand above the elbow and returns to the selected pose', () => {
  const { motion, bones } = rig(); motion.wave();
  for (let i = 0; i < 80; i++) motion.update(1 / 60);
  assert.ok(position(bones.rightHand.node).y > position(bones.rightLowerArm.node).y + .15);
  motion.setPose('relaxed');
  for (let i = 0; i < 360; i++) motion.update(1 / 60);
  assert.ok(bones.rightUpperArm.node.quaternion.angleTo(motion.poses.relaxed!.rightUpperArm) < .001);
});

test('activity transitions and prolonged animation keep bone rotations finite and normalized', () => {
  const { motion, bones } = rig();
  for (const activity of ['listening', 'thinking', 'speaking', 'idle'] as const) {
    motion.setActivity(activity);
    for (let i = 0; i < 600; i++) motion.update(1 / 60, .3);
    for (const { node } of Object.values(bones)) {
      assert.ok(node.quaternion.toArray().every(Number.isFinite));
      assert.ok(Math.abs(node.quaternion.length() - 1) < .00001);
    }
  }
});
