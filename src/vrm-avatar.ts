import { AvatarEffects } from './avatar-effects.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AvatarMotion } from './avatar-motion.js';
import type { AvatarMotionVrm } from './avatar-motion.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import { FrameLoop } from './frame-loop.js';

export interface SpriteAvatarDelegate {
  mouth: number;
  setEffectsEnabled: (value: unknown) => void;
  setMusicPlaying: (value: unknown) => void;
  setPose: (pose: string) => void;
  setActivity: (activity: string) => void;
  wave: () => void;
  look: (x: number, y: number) => void;
  hitTest: (x: number, y: number) => boolean;
  setFloating: (value: boolean) => void;
  frameTorso: () => void;
}

export interface VrmPowerOptions {
  fps?: number;
}

interface WorkspaceCameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export class VrmAvatar {
  container: HTMLElement;
  mode: 'vrm' | 'sprite';
  active: boolean;
  awake: boolean;
  disposed: boolean;
  loadEpoch: number;
  powerPaused: boolean;
  effects: AvatarEffects;
  effectsEnabled: boolean;
  musicPlaying: boolean;
  vocalMusic: boolean;
  headPoint: THREE.Vector3;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  placeholder: THREE.Group;
  orb: THREE.Mesh;
  _mouth: number;
  activity: string;
  pose: string;
  floating: boolean;
  raycaster: THREE.Raycaster;
  clock: THREE.Clock;
  elapsed: number;
  resizeObserver: ResizeObserver;
  frameLoop: FrameLoop;
  onVisibility: () => void;
  vrm: VRM | null;
  motion: AvatarMotion | null;
  modelBounds: THREE.Box3 | null;
  workspaceCamera: WorkspaceCameraState | null;
  spriteAvatar?: SpriteAvatarDelegate;

  constructor(container: HTMLElement, effects: AvatarEffects) {
    this.container = container;
    this.mode = 'vrm';
    this.active = false;
    this.awake = true;
    this.disposed = false;
    this.loadEpoch = 0;
    this.powerPaused = false;

    this.effects = effects;
    this.effectsEnabled = true;
    this.musicPlaying = false;
    this.vocalMusic = false;
    this.headPoint = new THREE.Vector3();

    // 3D Three.js WebGL Renderer for VRM
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.inset = '0';
    this.renderer.domElement.style.display = 'none'; // hidden by default while sprite is active
    container.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    this.camera.position.set(0, 1.1, 3.7);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 8;
    this.scene.add(new THREE.HemisphereLight(0xdbe9ff, 0x606080, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(1, 2, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x889dff, 0.5);
    rim.position.set(-2, 1, -2);
    this.scene.add(rim);

    // Abstract placeholder
    this.placeholder = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0x9fb6ff, emissive: 0x43568a, emissiveIntensity: 0.6, metalness: 0.7, roughness: 0.3 });
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.30, 3), material);
    this.placeholder.add(this.orb);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.51 + i * 0.1, 0.006, 8, 96), new THREE.MeshBasicMaterial({ color: i === 1 ? 0xe5d5b6 : 0x809ddb, transparent: true, opacity: 0.65 }));
      ring.rotation.set(Math.PI * (0.25 + i * 0.22), i * 0.6, i * 0.6);
      this.placeholder.add(ring);
    }
    this.placeholder.position.y = 1;
    this.scene.add(this.placeholder);

    this._mouth = 0;
    this.activity = 'idle';
    this.pose = 'crossed';
    this.floating = false;
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.vrm = null;
    this.motion = null;
    this.modelBounds = null;
    this.workspaceCamera = null;

    this.resizeObserver = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width && height) {
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }
    });
    this.resizeObserver.observe(container);

    this.frameLoop = new FrameLoop(() => this.frame());
    this.onVisibility = () => this.syncLoop();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get mouth(): number {
    return this._mouth;
  }

  set mouth(value: number) {
    this._mouth = value;
    if (this.spriteAvatar) this.spriteAvatar.mouth = value;
  }

  syncLoop(): void {
    this.frameLoop.setRunning(!this.disposed && this.active && this.awake && !this.powerPaused && !document.hidden);
  }

  setActive(value: boolean): void {
    this.active = value;
    this.renderer.domElement.style.display = value ? 'block' : 'none';
    this.clock.getDelta();
    this.syncLoop();
  }

  setPower(value: VrmPowerOptions = {}): void {
    this.powerPaused = value.fps === 0;
    this.frameLoop.setFPS(value.fps || 30);
    this.syncLoop();
  }

  setAwake(value: boolean): void {
    this.awake = value;
    this.clock.getDelta();
    this.syncLoop();
  }

  setEffectsEnabled(value: unknown): void {
    this.effectsEnabled = Boolean(value);
    this.spriteAvatar?.setEffectsEnabled(value);
  }

  setMusicPlaying(value: unknown): void {
    this.musicPlaying = Boolean(value);
    this.spriteAvatar?.setMusicPlaying(value);
  }

  setPose(pose: string): void {
    this.pose = pose;
    this.spriteAvatar?.setPose(pose);
    this.motion?.setPose(pose);
  }

  setActivity(activity: string): void {
    this.activity = activity;
    this.spriteAvatar?.setActivity(activity);
    this.motion?.setActivity(activity);
  }

  wave(): void {
    if (this.mode === 'sprite') {
      this.spriteAvatar?.wave();
    } else {
      this.motion?.wave();
    }
  }

  look(x: number, y: number): void {
    if (this.mode === 'sprite') {
      const rect = this.container.getBoundingClientRect();
      this.spriteAvatar?.look((x - rect.left) / rect.width * 2 - 1, (y - rect.top) / rect.height * 2 - 1);
    } else {
      const rect = this.container.getBoundingClientRect();
      this.motion?.look((x - rect.left) / rect.width * 2 - 1, (y - rect.top) / rect.height * 2 - 1);
    }
  }

  hitTest(x: number, y: number): boolean {
    if (this.mode === 'sprite') {
      return this.spriteAvatar?.hitTest(x, y) || false;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.camera);
    return this.raycaster.intersectObject(this.vrm?.scene || this.placeholder, true).length > 0;
  }

  setFloating(value: boolean): void {
    if (value === this.floating) return;
    this.floating = value;
    this.spriteAvatar?.setFloating(value);

    if (this.mode === 'vrm') {
      if (value) {
        this.workspaceCamera = { position: this.camera.position.clone(), target: this.controls.target.clone() };
      }
      this.controls.enabled = !value;
      if (value) this.frameTorso();
      else if (this.workspaceCamera) {
        this.camera.position.copy(this.workspaceCamera.position);
        this.controls.target.copy(this.workspaceCamera.target);
        this.controls.update();
      }
    }
  }

  frameTorso(): void {
    if (this.mode === 'sprite') {
      this.spriteAvatar?.frameTorso();
      return;
    }
    if (!this.modelBounds) return;
    const { min, max } = this.modelBounds;
    const height = max.y - min.y;
    const centerY = min.y + height * 0.80;
    const visibleHeight = height * 0.48;
    const distance = visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.controls.target.set(0, centerY, 0);
    this.camera.position.set(0, centerY, distance);
    this.controls.update();
  }

  async load(bytes: Uint8Array, autoSwitch = true): Promise<void> {
    const epoch = ++this.loadEpoch;
    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
    loader.manager.setURLModifier(url => {
      if (/^(data:|blob:)/.test(url)) return url;
      throw new Error('Avatar must contain embedded textures. Export a self-contained VRM.');
    });
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
    const next = gltf.userData.vrm as VRM | undefined;
    if (!next) { VRMUtils.deepDispose(gltf.scene); throw new Error('This file is not a supported VRM avatar.'); }
    if (this.disposed || epoch !== this.loadEpoch) { VRMUtils.deepDispose(next.scene); return; }
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
    }
    this.vrm = next;
    VRMUtils.rotateVRM0(this.vrm);
    this.scene.add(next.scene);
    this.placeholder.visible = false;
    next.scene.traverse(object => { object.frustumCulled = false; });
    for (const [bone, angle] of [['leftUpperArm', -1.15], ['rightUpperArm', 1.15]] as const) {
      const node = next.humanoid?.getNormalizedBoneNode(bone);
      if (node) node.rotation.z = angle;
    }
    next.update(0);
    const bounds = new THREE.Box3().setFromObject(next.scene);
    this.modelBounds = bounds;
    const height = bounds.max.y - bounds.min.y;
    this.controls.target.set(0, bounds.min.y + height * 0.55, 0);
    this.camera.position.set(0, height * 0.6, height * 2.05);
    this.controls.update();
    this.workspaceCamera = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    if (this.floating) this.frameTorso();
    this.motion = new AvatarMotion(next as unknown as AvatarMotionVrm);
    this.motion.setPose(this.pose);
    this.motion.setActivity(this.activity);

    // Switch to VRM mode if requested
    if (autoSwitch) {
      this.setActive(true);
    }
  }

  frame(): void {
    if (this.mode !== 'vrm') return; // SpriteAvatar manages its own loop when in sprite mode
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    this.placeholder.rotation.y += dt * 0.15;
    this.orb.scale.setScalar(1 + Math.sin(this.elapsed * 1.7) * 0.03 + this.mouth * 0.15);
    if (this.vrm) {
      this.motion?.update(dt, this.mouth);
      this.vrm.update(dt);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const rect = this.container.getBoundingClientRect();
    const headBone = this.vrm?.humanoid?.getRawBoneNode('head');
    if (headBone) headBone.getWorldPosition(this.headPoint);
    else this.headPoint.copy(this.placeholder.position);
    this.headPoint.y += this.modelBounds ? (this.modelBounds.max.y - this.modelBounds.min.y) * 0.055 : 0.25;
    this.headPoint.project(this.camera);
    const head = Math.abs(this.headPoint.z) <= 1 && Math.abs(this.headPoint.x) < 1.2 && Math.abs(this.headPoint.y) < 1.2
      ? { x: (this.headPoint.x + 1) * rect.width / 2, y: (1 - this.headPoint.y) * rect.height / 2 } : null;
    this.effects.draw({
      width: rect.width,
      height: rect.height,
      head,
      time: this.elapsed,
      activity: this.vocalMusic ? 'singing' : this.activity,
      music: this.musicPlaying,
      enabled: this.effectsEnabled,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadEpoch++;
    this.frameLoop.dispose();
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.controls.dispose();
    VRMUtils.deepDispose(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.vrm = null;
    this.motion = null;
  }
}
