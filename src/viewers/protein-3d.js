// Lazy-loaded Three.js 3D Protein Ribbon/pLDDT Renderer (Phase 2, Stage 6 — Decision #5).
// Uses bundled `three` (zero CDN, zero 8+ MB Mol* overhead) to render smooth C-alpha ribbon tubes colored
// by AlphaFold pLDDT confidence bands + oncogenic/variant hotspot spheres + interactive drag orbit & zoom,
// with automatic graceful fallback to 2D projected Canvas if WebGL is unavailable.

export function plddtHex(score) {
  if (score >= 90) return '#2563eb';
  if (score >= 70) return '#38bdf8';
  if (score >= 50) return '#facc15';
  return '#fb923c';
}

export function syntheticBackbone(length = 189, hotspots = []) {
  const hotSet = new Set((hotspots || []).map(h => Number(h.pos)));
  const out = [];
  for (let i = 0; i < length; i++) {
    const t = i / Math.max(1, length);
    const lobe = Math.sin(t * Math.PI * 5.2) * 0.45;
    const nx = (Math.cos(t * Math.PI * 7.5) * (1.05 + lobe * 0.4) + Math.sin(t * Math.PI * 2) * 0.5) * 0.55;
    const ny = (Math.sin(t * Math.PI * 7.5) * (0.85 - lobe * 0.2) + (t - 0.5) * 0.9) * 0.55;
    const nz = (Math.cos(t * Math.PI * 3.8) * 0.95 + Math.sin(t * Math.PI * 11) * 0.22) * 0.55;
    const plddt = i > length - 21 ? 44 + (length - i) * 1.4 : i > length - 31 ? 75 : i < 10 ? 84 : 93 + Math.sin(i * 0.3) * 4;
    out.push({ res: i + 1, name: hotSet.has(i + 1) ? 'HOT' : 'ALA', chain: 'A', nx, ny, nz, plddt: Math.min(99, Math.max(30, plddt)) });
  }
  return out;
}

function mountCanvasFallback(container, { residues, hotspots, onHover }) {
  const canvas = document.createElement('canvas');
  canvas.width = 760;
  canvas.height = 240;
  canvas.className = 'rsv-rib-canvas';
  const ctx = canvas.getContext('2d');
  let yaw = 0.55, pitch = 0.25, zoom = 1, dragging = false, lastX = 0, lastY = 0;
  const hotByPos = new Map((hotspots || []).map(h => [Number(h.pos), h]));

  const draw = () => {
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const proj = residues.map(p => {
      const x1 = p.nx * cy - p.nz * sy, z1 = p.nx * sy + p.nz * cy;
      const y2 = p.ny * cp - z1 * sp, z2 = p.ny * sp + z1 * cp;
      const sc = (180 * zoom) / (2.7 + z2 * 0.6);
      return { ...p, sx: w / 2 + x1 * sc * 1.35, sy: h / 2 + y2 * sc * 1.15, z2, sc };
    });
    const segs = [];
    for (let i = 0; i < proj.length - 1; i++) {
      if (proj[i].chain !== proj[i + 1].chain) continue;
      segs.push([proj[i], proj[i + 1], (proj[i].z2 + proj[i + 1].z2) / 2]);
    }
    segs.sort((a, b) => a[2] - b[2]);
    ctx.lineCap = 'round';
    for (const [a, b] of segs) {
      ctx.strokeStyle = plddtHex(a.plddt);
      ctx.lineWidth = Math.max(3.5, a.sc * 0.08);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
    for (const p of proj) {
      const hInfo = hotByPos.get(Number(p.res));
      if (!hInfo) continue;
      ctx.fillStyle = '#db2777';
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '600 11.5px Inter, sans-serif';
      ctx.fillText(hInfo.label || String(p.res), p.sx + 9, p.sy + 4);
    }
  };
  draw();

  canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (dragging) {
      yaw += (e.clientX - lastX) * 0.012;
      pitch += (e.clientY - lastY) * 0.012;
      lastX = e.clientX;
      lastY = e.clientY;
      draw();
      return;
    }
    if (typeof onHover === 'function' && residues.length) {
      const rect = canvas.getBoundingClientRect();
      const idx = Math.max(0, Math.min(residues.length - 1, Math.floor(((e.clientX - rect.left) / Math.max(1, rect.width)) * residues.length)));
      onHover(residues[idx]);
    }
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(0.5, Math.min(2.5, zoom * (e.deltaY < 0 ? 1.08 : 0.92))); draw(); }, { passive: false });

  container.replaceChildren(canvas);
  return {
    reset() { yaw = 0.55; pitch = 0.25; zoom = 1; draw(); },
    setMode() { draw(); },
    dispose() {},
  };
}

export async function mountProtein3D(container, { residues = [], hotspots = [], mode = 'ribbon', onHover = null } = {}) {
  if (!container) return { reset() {}, setMode() {}, dispose() {} };
  const pts = residues.length ? residues : syntheticBackbone(189, hotspots);

  let THREE;
  try {
    THREE = await import('three');
  } catch {
    return mountCanvasFallback(container, { residues: pts, hotspots, onHover });
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return mountCanvasFallback(container, { residues: pts, hotspots, onHover });
  }

  const width = Math.max(320, Math.round(container.clientWidth || 640));
  const height = 240;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height, false);
  renderer.domElement.className = 'rsv-rib-canvas rsv-rib-webgl';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = `${height}px`;
  container.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 50);
  camera.position.set(0, 0, 3.3);

  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.05);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.45);
  rimLight.position.set(-5, -3, -4);
  scene.add(rimLight);

  const rootGroup = new THREE.Group();
  rootGroup.rotation.set(0.25, 0.55, 0);
  scene.add(rootGroup);

  // Split residues by chain so multi-chain structures don't draw artificial jumps across chains.
  const chains = new Map();
  for (const r of pts) {
    const ch = r.chain || 'A';
    if (!chains.has(ch)) chains.set(ch, []);
    chains.get(ch).push(r);
  }

  const geometries = [];
  const materials = [];
  let activeMode = mode === 'backbone' ? 'backbone' : 'ribbon';

  function buildGeometry() {
    while (rootGroup.children.length) rootGroup.remove(rootGroup.children[0]);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    geometries.length = 0;
    materials.length = 0;

    const radius = activeMode === 'backbone' ? 0.022 : 0.046;
    const radialSegs = activeMode === 'backbone' ? 6 : 10;

    for (const chainRes of chains.values()) {
      if (chainRes.length < 2) continue;
      const vectors = chainRes.map(r => new THREE.Vector3(r.nx * 1.15, r.ny * 1.15, r.nz * 1.15));
      const curve = new THREE.CatmullRomCurve3(vectors);
      const tubularSegs = Math.min(1600, Math.max(48, chainRes.length * 3));
      const geo = new THREE.TubeGeometry(curve, tubularSegs, radius, radialSegs, false);

      const posAttr = geo.attributes.position;
      const colors = new Float32Array(posAttr.count * 3);
      const col = new THREE.Color();
      const ringVerts = radialSegs + 1;
      for (let i = 0; i <= tubularSegs; i++) {
        const t = i / tubularSegs;
        const rIdx = Math.min(chainRes.length - 1, Math.floor(t * (chainRes.length - 1)));
        col.set(plddtHex(chainRes[rIdx].plddt));
        for (let j = 0; j < ringVerts; j++) {
          const vi = i * ringVerts + j;
          if (vi * 3 + 2 < colors.length) {
            colors[vi * 3] = col.r;
            colors[vi * 3 + 1] = col.g;
            colors[vi * 3 + 2] = col.b;
          }
        }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.12 });
      geometries.push(geo);
      materials.push(mat);
      rootGroup.add(new THREE.Mesh(geo, mat));
    }

    // Oncogenic / pathogenic variant hotspot markers
    const hotByPos = new Map((hotspots || []).map(h => [Number(h.pos), h]));
    if (hotByPos.size) {
      const sGeo = new THREE.SphereGeometry(0.085, 16, 16);
      const sMat = new THREE.MeshStandardMaterial({ color: 0xdb2777, emissive: 0x831843, emissiveIntensity: 0.55, roughness: 0.25 });
      geometries.push(sGeo);
      materials.push(sMat);
      for (const r of pts) {
        if (!hotByPos.has(Number(r.res))) continue;
        const mesh = new THREE.Mesh(sGeo, sMat);
        mesh.position.set(r.nx * 1.15, r.ny * 1.15, r.nz * 1.15);
        rootGroup.add(mesh);
      }
    }
  }

  let disposed = false;
  let dragging = false, lastX = 0, lastY = 0;
  let rafId = 0;

  const renderFrame = () => {
    rafId = 0;
    if (disposed) return;
    renderer.render(scene, camera);
  };
  const scheduleRender = () => {
    if (disposed || rafId) return;
    rafId = requestAnimationFrame(renderFrame);
  };

  buildGeometry();
  renderFrame();

  const dom = renderer.domElement;
  const onDown = e => { dragging = true; lastX = e.clientX; lastY = e.clientY; dom.setPointerCapture?.(e.pointerId); };
  const onMove = e => {
    if (dragging) {
      rootGroup.rotation.y += (e.clientX - lastX) * 0.011;
      rootGroup.rotation.x += (e.clientY - lastY) * 0.011;
      lastX = e.clientX;
      lastY = e.clientY;
      scheduleRender();
      return;
    }
    if (typeof onHover === 'function' && pts.length) {
      const rect = dom.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      onHover(pts[Math.min(pts.length - 1, Math.floor(frac * pts.length))]);
    }
  };
  const onUp = () => { dragging = false; };
  const onWheel = e => {
    e.preventDefault();
    camera.position.z = Math.max(1.5, Math.min(6.5, camera.position.z * (e.deltaY > 0 ? 1.08 : 0.92)));
    scheduleRender();
  };
  const onDblClick = () => {
    rootGroup.rotation.set(0.25, 0.55, 0);
    camera.position.set(0, 0, 3.3);
    scheduleRender();
  };

  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('dblclick', onDblClick);

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (disposed) return;
    const nw = Math.max(260, Math.round(container.clientWidth || width));
    camera.aspect = nw / height;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, height, false);
    scheduleRender();
  }) : null;
  ro?.observe(container);

  return {
    reset() {
      rootGroup.rotation.set(0.25, 0.55, 0);
      camera.position.set(0, 0, 3.3);
      scheduleRender();
    },
    setMode(nextMode) {
      activeMode = nextMode === 'backbone' ? 'backbone' : 'ribbon';
      buildGeometry();
      scheduleRender();
    },
    dispose() {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      ro?.disconnect();
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('dblclick', onDblClick);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      renderer.dispose();
    },
  };
}
