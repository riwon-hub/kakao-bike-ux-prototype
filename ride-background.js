import * as THREE from './assets/three.module.min.js';

const scenery = document.getElementById('rideScenery');
const ridingPhone = document.getElementById('phone');
const desktopScenery = window.matchMedia('(min-width:1001px), (min-width:701px) and (pointer:fine)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion:reduce)');
const bicycle = document.querySelector('.device');
let renderer;
let scene;
let camera;
let animationFrame = 0;
let previousTime = 0;
let distanceTravelled = 0;
let moving = false;
const traffic = [];
const sceneScale = .12;
const plannedRoute = JSON.parse(scenery.dataset.route);
const routeOrigin = plannedRoute[0];
const targetPosition = new THREE.Vector3();
const currentPosition = new THREE.Vector3();
let targetHeading = 0;
let currentHeading = 0;
let currentSpeed = 0;
let currentLean = 0;
let pedalPhase = 0;
let motionRoute;
let motionShape;
let maxAnisotropy = 4;

// 오전 10시 무렵의 맑은 하늘: 태양은 앞쪽 왼편, 고도 약 38도.
const sunDirection = new THREE.Vector3(-.68, .62, -.39).normalize();
const horizonColor = new THREE.Color('#c4d6e4');
const zenithColor = new THREE.Color('#2f6fbf');

// A fixed seed keeps the streetscape consistent between test sessions.
let randomSeed = 41721;
function random() {
  randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
  return randomSeed / 4294967296;
}

/* ---------- 텍스처 도우미 ---------- */

function canvasTexture(width, height, draw, color = true) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// 타일링되는 값 노이즈(0~1). 텍스처 이음새가 보이지 않도록 격자를 감싼다.
function tileNoise(size, cells, octaves = 4) {
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const n = cells << octave;
    const lattice = new Float32Array(n * n);
    for (let index = 0; index < lattice.length; index++) lattice[index] = random();
    for (let y = 0; y < size; y++) {
      const fy = y / size * n;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const row0 = (y0 % n) * n;
      const row1 = ((y0 + 1) % n) * n;
      for (let x = 0; x < size; x++) {
        const fx = x / size * n;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % n;
        const top = lattice[row0 + x0] + (lattice[row0 + x1] - lattice[row0 + x0]) * sx;
        const bottom = lattice[row1 + x0] + (lattice[row1 + x1] - lattice[row1 + x0]) * sx;
        out[y * size + x] += (top + (bottom - top) * sy) * amplitude;
      }
    }
    total += amplitude;
    amplitude *= .5;
  }
  for (let index = 0; index < out.length; index++) out[index] /= total;
  return out;
}

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [value >> 16 & 255, value >> 8 & 255, value & 255];
}

function finishTexture(texture, repeatX, repeatY) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = maxAnisotropy;
  return texture;
}

// 아스팔트·컬러 포장: 골재 알갱이, 얼룩, 마모 + 범프맵.
function asphaltMaps(hex, options = {}) {
  const size = 512;
  const { speckle = .22, wear = .18, contrast = .22 } = options;
  const base = hexToRgb(hex);
  const broad = tileNoise(size, 4, 4);
  const fine = tileNoise(size, 64, 2);
  const colorData = new ImageData(size, size);
  const bumpData = new ImageData(size, size);
  for (let index = 0; index < size * size; index++) {
    let shade = 1 + (broad[index] - .5) * contrast + (fine[index] - .5) * .18;
    let bump = fine[index] * .6 + .2;
    const grain = random();
    if (grain < speckle * .5) { shade += .16 + random() * .14; bump += .35; }
    else if (grain < speckle) { shade -= .1 + random() * .1; bump -= .2; }
    shade += Math.max(0, broad[index] - .62) * wear * 2.4;
    const pixel = index * 4;
    for (let channel = 0; channel < 3; channel++) colorData.data[pixel + channel] = Math.max(0, Math.min(255, base[channel] * shade));
    colorData.data[pixel + 3] = 255;
    const value = Math.max(0, Math.min(255, bump * 255));
    bumpData.data[pixel] = bumpData.data[pixel + 1] = bumpData.data[pixel + 2] = value;
    bumpData.data[pixel + 3] = 255;
  }
  const map = canvasTexture(size, size, context => context.putImageData(colorData, 0, 0));
  const bumpMap = canvasTexture(size, size, context => context.putImageData(bumpData, 0, 0), false);
  return { map, bumpMap };
}

// 보도블록: 블록별 색 편차, 줄눈, 모서리 마모.
function pavingMaps(hex, columns = 4, rows = 8) {
  const size = 512;
  const base = hexToRgb(hex);
  const fine = tileNoise(size, 32, 3);
  const blockWidth = size / columns;
  const blockHeight = size / rows;
  const tones = [];
  for (let row = 0; row < rows; row++) {
    tones.push([]);
    for (let column = 0; column <= columns; column++) tones[row].push(.86 + random() * .24);
  }
  const colorData = new ImageData(size, size);
  const bumpData = new ImageData(size, size);
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / blockHeight);
    const offset = (row % 2) * blockWidth / 2;
    const localY = y - row * blockHeight;
    for (let x = 0; x < size; x++) {
      const shifted = (x + offset) % size;
      const column = Math.floor(shifted / blockWidth);
      const localX = shifted - column * blockWidth;
      const edge = Math.min(localX, blockWidth - localX, localY, blockHeight - localY);
      const index = y * size + x;
      const grout = edge < 2.2;
      let shade = grout ? .58 : tones[row][column] * (.92 + fine[index] * .16);
      if (!grout && edge < 5) shade *= .94 + edge * .012;
      if (random() < .05) shade += (random() - .5) * .14;
      const pixel = index * 4;
      for (let channel = 0; channel < 3; channel++) colorData.data[pixel + channel] = Math.max(0, Math.min(255, base[channel] * shade));
      colorData.data[pixel + 3] = 255;
      const value = grout ? 20 : Math.min(255, 150 + Math.min(edge, 8) * 10 + fine[index] * 40);
      bumpData.data[pixel] = bumpData.data[pixel + 1] = bumpData.data[pixel + 2] = value;
      bumpData.data[pixel + 3] = 255;
    }
  }
  const map = canvasTexture(size, size, context => context.putImageData(colorData, 0, 0));
  const bumpMap = canvasTexture(size, size, context => context.putImageData(bumpData, 0, 0), false);
  return { map, bumpMap };
}

// 잔디·흙: 잎 방향성을 가진 노이즈.
function grassMaps(hex) {
  const size = 256;
  const base = hexToRgb(hex);
  const broad = tileNoise(size, 4, 3);
  const fine = tileNoise(size, 64, 2);
  const colorData = new ImageData(size, size);
  for (let index = 0; index < size * size; index++) {
    const blade = random();
    let shade = .8 + broad[index] * .35 + (fine[index] - .5) * .3;
    if (blade < .12) shade += .22;
    const pixel = index * 4;
    colorData.data[pixel] = Math.min(255, base[0] * shade * (1 + (broad[index] - .5) * .25));
    colorData.data[pixel + 1] = Math.min(255, base[1] * shade);
    colorData.data[pixel + 2] = Math.min(255, base[2] * shade);
    colorData.data[pixel + 3] = 255;
  }
  return canvasTexture(size, size, context => context.putImageData(colorData, 0, 0));
}

function softShadowTexture() {
  return canvasTexture(128, 128, (context, width, height) => {
    const gradient = context.createRadialGradient(64, 64, 6, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(0,0,0,.62)');
    gradient.addColorStop(.55, 'rgba(0,0,0,.34)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  });
}

function addBox(parent, dimensions, position, material, castShadow = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/* ---------- 건물 외벽 ---------- */

// 색상맵과 거칠기맵을 같은 레이아웃으로 그려 유리창만 하늘을 반사하게 한다.
function facadeMaterial(color, floors, style = {}) {
  const width = 512;
  const height = 1024;
  const frame = style.frame ?? (random() > .5 ? '#c9cbc7' : '#41474a');
  const columns = style.columns ?? 5;
  const top = 24;
  const groundTop = 850;
  const rowHeight = (groundTop - top) / floors;
  const columnWidth = (width - 24) / columns;
  const windows = [];
  for (let row = 0; row < floors; row++) {
    for (let column = 0; column < columns; column++) {
      windows.push({
        x: 12 + column * columnWidth + 10,
        y: top + row * rowHeight + 8,
        w: columnWidth - 20,
        h: rowHeight - 24,
        blind: random() < .28 ? .2 + random() * .55 : 0,
        tint: random(),
        reflect: random()
      });
    }
  }
  const stains = Array.from({ length: 26 }, () => [random() * width, random() * groundTop, 4 + random() * 10, 60 + random() * 180]);
  const wallNoise = tileNoise(128, 8, 3);
  const noiseCanvas = document.createElement('canvas');
  noiseCanvas.width = noiseCanvas.height = 128;
  const noiseContext = noiseCanvas.getContext('2d');
  const noiseImage = noiseContext.createImageData(128, 128);
  for (let index = 0; index < wallNoise.length; index++) {
    const value = wallNoise[index] * 255;
    noiseImage.data.set([value, value, value, 40], index * 4);
  }
  noiseContext.putImageData(noiseImage, 0, 0);

  const map = canvasTexture(width, height, context => {
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'overlay';
    context.fillStyle = context.createPattern(noiseCanvas, 'repeat');
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    const weathering = context.createLinearGradient(0, 0, 0, groundTop);
    weathering.addColorStop(0, 'rgba(255,255,255,.06)');
    weathering.addColorStop(1, 'rgba(60,55,45,.12)');
    context.fillStyle = weathering;
    context.fillRect(0, 0, width, groundTop);
    for (const [x, y, w, h] of stains) {
      const streak = context.createLinearGradient(0, y, 0, y + h);
      streak.addColorStop(0, 'rgba(40,40,35,.09)');
      streak.addColorStop(1, 'rgba(40,40,35,0)');
      context.fillStyle = streak;
      context.fillRect(x, y, w, h);
    }
    for (let row = 1; row < floors; row++) {
      const y = top + row * rowHeight - 6;
      context.fillStyle = 'rgba(255,255,255,.18)';
      context.fillRect(0, y, width, 3);
      context.fillStyle = 'rgba(0,0,0,.12)';
      context.fillRect(0, y + 3, width, 3);
    }
    for (const pane of windows) {
      context.fillStyle = frame;
      context.fillRect(pane.x - 4, pane.y - 4, pane.w + 8, pane.h + 8);
      const glass = context.createLinearGradient(pane.x, pane.y, pane.x + pane.w * .3, pane.y + pane.h);
      glass.addColorStop(0, pane.tint > .5 ? '#9fbdd3' : '#8aa7bb');
      glass.addColorStop(.5, pane.reflect > .35 ? '#56717f' : '#6e8290');
      glass.addColorStop(1, '#2d3d47');
      context.fillStyle = glass;
      context.fillRect(pane.x, pane.y, pane.w, pane.h);
      if (pane.blind) {
        context.fillStyle = 'rgba(226,220,205,.82)';
        context.fillRect(pane.x, pane.y, pane.w, pane.h * pane.blind);
        context.fillStyle = 'rgba(0,0,0,.06)';
        for (let line = pane.y + 4; line < pane.y + pane.h * pane.blind; line += 5) context.fillRect(pane.x, line, pane.w, 1);
      }
      context.fillStyle = 'rgba(255,255,255,.12)';
      context.beginPath();
      context.moveTo(pane.x + pane.w * .15, pane.y + pane.h);
      context.lineTo(pane.x + pane.w * .45, pane.y);
      context.lineTo(pane.x + pane.w * .62, pane.y);
      context.lineTo(pane.x + pane.w * .32, pane.y + pane.h);
      context.fill();
      context.fillStyle = frame;
      context.fillRect(pane.x + pane.w / 2 - 2, pane.y, 4, pane.h);
      context.fillStyle = 'rgba(0,0,0,.18)';
      context.fillRect(pane.x - 4, pane.y + pane.h + 4, pane.w + 8, 4);
    }
    // 1층 상가
    context.fillStyle = '#3c4247';
    context.fillRect(0, groundTop, width, height - groundTop);
    context.fillStyle = 'rgba(0,0,0,.25)';
    context.fillRect(0, groundTop, width, 10);
    for (let column = 0; column < 4; column++) {
      const x = 14 + column * 124;
      const glass = context.createLinearGradient(0, groundTop + 30, 0, height);
      glass.addColorStop(0, '#7d95a3');
      glass.addColorStop(.45, '#3a4c56');
      glass.addColorStop(1, '#1f2a30');
      context.fillStyle = glass;
      context.fillRect(x, groundTop + 28, 108, height - groundTop - 28);
      context.fillStyle = 'rgba(240,232,210,.18)';
      context.fillRect(x + 10, groundTop + 90, 30 + random() * 50, 50);
      context.fillStyle = '#2a2f33';
      context.fillRect(x + 52, groundTop + 28, 4, height - groundTop - 28);
    }
  });
  const roughnessMap = canvasTexture(width, height, context => {
    context.fillStyle = 'rgb(230,230,230)';
    context.fillRect(0, 0, width, height);
    for (const pane of windows) {
      context.fillStyle = 'rgb(110,110,110)';
      context.fillRect(pane.x - 4, pane.y - 4, pane.w + 8, pane.h + 8);
      context.fillStyle = 'rgb(22,22,22)';
      context.fillRect(pane.x, pane.y, pane.w, pane.h);
      if (pane.blind) {
        context.fillStyle = 'rgb(60,60,60)';
        context.fillRect(pane.x, pane.y, pane.w, pane.h * pane.blind);
      }
    }
    context.fillStyle = 'rgb(150,150,150)';
    context.fillRect(0, groundTop, width, height - groundTop);
    context.fillStyle = 'rgb(25,25,25)';
    for (let column = 0; column < 4; column++) context.fillRect(14 + column * 124, groundTop + 28, 108, height - groundTop - 28);
  }, false);
  map.anisotropy = roughnessMap.anisotropy = maxAnisotropy;
  return new THREE.MeshStandardMaterial({ map, roughnessMap, roughness: 1, metalness: .04 });
}

// 원경의 판상형 아파트 외벽.
function apartmentMaterial() {
  const width = 512;
  const height = 1024;
  const floors = 20;
  const units = 6;
  const rowHeight = (height - 70) / floors;
  const unitWidth = width / units;
  const map = canvasTexture(width, height, context => {
    context.fillStyle = '#ece8df';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#7e93a6';
    context.fillRect(0, 0, width, 46);
    context.fillStyle = '#d8d3c8';
    context.fillRect(0, 46, width, 24);
    for (let floor = 0; floor < floors; floor++) {
      const y = 70 + floor * rowHeight;
      for (let unit = 0; unit < units; unit++) {
        const x = unit * unitWidth;
        const glass = context.createLinearGradient(0, y, 0, y + rowHeight);
        glass.addColorStop(0, '#9db3c4');
        glass.addColorStop(1, random() > .5 ? '#4f6372' : '#62727d');
        context.fillStyle = glass;
        context.fillRect(x + 8, y + 6, unitWidth - 16, rowHeight - 18);
        if (random() < .35) {
          context.fillStyle = 'rgba(232,226,210,.85)';
          context.fillRect(x + 8, y + 6, (unitWidth - 16) * (.3 + random() * .5), rowHeight - 18);
        }
        context.fillStyle = 'rgba(255,255,255,.55)';
        context.fillRect(x + 8, y + rowHeight * .55, unitWidth - 16, 2);
      }
      context.fillStyle = '#f6f3ec';
      context.fillRect(0, y + rowHeight - 12, width, 10);
      context.fillStyle = 'rgba(0,0,0,.12)';
      context.fillRect(0, y + rowHeight - 2, width, 2);
    }
    for (let unit = 0; unit <= units; unit++) {
      context.fillStyle = '#e4dfd4';
      context.fillRect(unit * unitWidth - 4, 70, 8, height - 70);
    }
  });
  map.anisotropy = maxAnisotropy;
  return new THREE.MeshStandardMaterial({ map, roughness: .85 });
}

function signMaterial(text, color) {
  const map = canvasTexture(512, 112, (context, width, height) => {
    const panel = context.createLinearGradient(0, 0, 0, height);
    panel.addColorStop(0, color);
    panel.addColorStop(1, new THREE.Color(color).multiplyScalar(.82).getStyle());
    context.fillStyle = panel;
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'rgba(255,255,255,.14)';
    context.fillRect(0, 0, width, 6);
    context.fillStyle = 'rgba(0,0,0,.25)';
    context.fillRect(0, height - 6, width, 6);
    context.fillStyle = '#fffdf5';
    context.font = '700 58px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(0,0,0,.25)';
    context.shadowOffsetY = 2;
    context.shadowBlur = 3;
    context.fillText(text, width / 2, height / 2 + 4);
  });
  return new THREE.MeshStandardMaterial({ map, roughness: .55 });
}

function makeBuilding(parent, side, z, height, color, sign, materials) {
  const depth = 7;
  const width = 9 + random() * 2;
  const x = side < 0 ? -18 : 21.5;
  const facade = facadeMaterial(color, Math.round(height / 3));
  // 앞면과 옆면 모두 창이 보이게 하고 지붕만 단색으로 둔다.
  const faces = [facade, facade, materials.roof, materials.roof, facade, facade];
  addBox(parent, [depth, height, width], [x, height / 2, z], faces, true);
  const frontX = x - side * (depth / 2 + .015);
  const trim = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(.85), roughness: .8 });
  addBox(parent, [depth + .2, .45, width + .2], [x, height + .2, z], trim, true);
  // 옥상 실외기·물탱크로 실루엣을 다듬는다.
  addBox(parent, [2 + random() * 1.5, 1.2, 2 + random()], [x + (random() - .5) * 2, height + .9, z + (random() - .5) * 3], materials.roofUnit, true);
  if (random() > .4) addBox(parent, [1.2, .8, 1.6], [x + (random() - .5) * 3, height + .7, z + (random() - .5) * 4], materials.metal, true);
  // 1층 차양
  const awning = addBox(parent, [1.1, .08, width - .6], [frontX - side * .55, 3.75, z], materials.awning, true);
  awning.rotation.z = side * .12;
  const shopSign = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1), sign);
  shopSign.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  shopSign.position.set(frontX - side * .04, 3.1, z);
  parent.add(shopSign);
}

/* ---------- 가로수 ---------- */

function foliageTexture() {
  return canvasTexture(256, 256, context => {
    for (let leaf = 0; leaf < 420; leaf++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.pow(random(), .7) * 104;
      const shade = Math.round(150 + random() * 105);
      context.fillStyle = `rgb(${shade},${shade},${shade})`;
      const x = 128 + Math.cos(angle) * radius;
      const y = 128 + Math.sin(angle) * radius;
      const length = 5 + random() * 7;
      const rotation = random() * Math.PI;
      context.beginPath();
      context.ellipse(x, y, length, length * .45, rotation, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = `rgba(0,0,0,.18)`;
      context.lineWidth = .8;
      context.beginPath();
      context.moveTo(x - Math.cos(rotation) * length, y - Math.sin(rotation) * length);
      context.lineTo(x + Math.cos(rotation) * length, y + Math.sin(rotation) * length);
      context.stroke();
    }
  });
}

function barkTexture() {
  const texture = canvasTexture(128, 256, (context, width, height) => {
    context.fillStyle = '#5f5246';
    context.fillRect(0, 0, width, height);
    for (let streak = 0; streak < 260; streak++) {
      const light = random() > .5;
      context.fillStyle = light ? 'rgba(170,155,135,.22)' : 'rgba(25,20,15,.3)';
      context.fillRect(random() * width, random() * height, 1 + random() * 3, 12 + random() * 50);
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

function makeTrees(parent, materials) {
  const positions = [];
  for (let index = 0; index < 4; index++) {
    positions.push([-7.4, -4 - index * 12]);
    positions.push([14.5, -10 - index * 12]);
  }
  const leavesPerTree = 300;
  const leafGeometry = new THREE.PlaneGeometry(1, 1);
  const leaves = new THREE.InstancedMesh(leafGeometry, materials.leaf, positions.length * leavesPerTree);
  const transform = new THREE.Object3D();
  const palette = ['#557a38', '#668a41', '#789b4a', '#8aa853', '#4a6b34'].map(hex => new THREE.Color(hex));
  const leafColor = new THREE.Color();
  let instance = 0;
  for (const [x, z] of positions) {
    const height = 4.1 + random() * .6;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.11, .2, height, 10), materials.bark);
    trunk.position.set(x, height / 2, z);
    trunk.rotation.z = (random() - .5) * .05;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    parent.add(trunk);
    addBox(parent, [1.4, .14, 1.9], [x, .07, z], materials.soil);
    addBox(parent, [1.5, .18, .1], [x, .09, z - 1], materials.curb);
    addBox(parent, [1.5, .18, .1], [x, .09, z + 1], materials.curb);
    for (let branch = 0; branch < 4; branch++) {
      const angle = branch * Math.PI / 2 + random() * .6;
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(.045, .09, 1.4, 6), materials.bark);
      limb.position.set(x + Math.cos(angle) * .32, height + .15, z + Math.sin(angle) * .32);
      limb.rotation.z = Math.cos(angle) * .7;
      limb.rotation.x = Math.sin(angle) * .7;
      limb.castShadow = true;
      parent.add(limb);
    }
    const crownY = height + .95;
    for (let cluster = 0; cluster < leavesPerTree; cluster++) {
      // 타원체 수관 안에 잎 뭉치를 흩뿌리고, 안쪽·아래쪽은 어둡게 해 입체감을 준다.
      const u = random() * 2 - 1;
      const theta = random() * Math.PI * 2;
      const r = Math.cbrt(random());
      const s = Math.sqrt(1 - u * u);
      const lx = s * Math.cos(theta) * r;
      const ly = u * r;
      const lz = s * Math.sin(theta) * r;
      transform.position.set(x + lx * 2.1, crownY + ly * 1.45, z + lz * 2.1);
      transform.scale.setScalar(.75 + random() * .7);
      transform.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      transform.updateMatrix();
      leaves.setMatrixAt(instance, transform.matrix);
      const exposure = THREE.MathUtils.clamp(.62 + r * .35 + ly * .25 + (lx * sunDirection.x + lz * sunDirection.z) * .15, .3, 1.15);
      leafColor.copy(palette[Math.floor(random() * palette.length)]).multiplyScalar(exposure);
      leaves.setColorAt(instance, leafColor);
      instance++;
    }
  }
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  parent.add(leaves);
}

function makeLamp(parent, x, z, material) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.045, .075, 6.5, 10), material);
  pole.position.set(x, 3.25, z);
  pole.castShadow = true;
  parent.add(pole);
  addBox(parent, [1.6, .07, .07], [x + .7, 6.45, z], material, true);
  addBox(parent, [.6, .1, .24], [x + 1.45, 6.42, z], material, true);
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(.5, .18), new THREE.MeshStandardMaterial({ color: '#f2f0e6', roughness: .2 }));
  lens.rotation.x = Math.PI / 2;
  lens.position.set(x + 1.45, 6.365, z);
  parent.add(lens);
}

function bicycleMarkMaterial() {
  const texture = canvasTexture(256, 256, (context) => {
    context.strokeStyle = 'rgba(255,255,248,.82)';
    context.lineWidth = 10;
    context.lineCap = 'round';
    for (const x of [62, 194]) {
      context.beginPath();
      context.arc(x, 169, 43, 0, Math.PI * 2);
      context.stroke();
    }
    context.beginPath();
    context.moveTo(62, 169);
    context.lineTo(107, 99);
    context.lineTo(145, 169);
    context.closePath();
    context.moveTo(107, 99);
    context.lineTo(172, 99);
    context.lineTo(194, 169);
    context.moveTo(145, 169);
    context.lineTo(172, 99);
    context.lineTo(160, 76);
    context.lineTo(185, 76);
    context.moveTo(92, 93);
    context.lineTo(115, 93);
    context.stroke();
    context.beginPath();
    context.moveTo(128, 45);
    context.lineTo(128, 8);
    context.moveTo(110, 26);
    context.lineTo(128, 8);
    context.lineTo(146, 26);
    context.stroke();
    // 도색이 살짝 닳은 느낌
    context.globalCompositeOperation = 'destination-out';
    for (let chip = 0; chip < 500; chip++) {
      context.fillStyle = `rgba(0,0,0,${.3 + random() * .5})`;
      context.fillRect(random() * 256, random() * 256, 1 + random() * 3, 1 + random() * 3);
    }
  });
  return new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: .7, polygonOffset: true, polygonOffsetFactor: -2 });
}

/* ---------- 경로 ---------- */

function mapToWorld(point) {
  return new THREE.Vector3((point[0] - routeOrigin[0]) * sceneScale, 0, (point[1] - routeOrigin[1]) * sceneScale);
}

function extendedRoute(points) {
  const firstDirection = points[1].clone().sub(points[0]).normalize();
  const lastDirection = points.at(-1).clone().sub(points.at(-2)).normalize();
  return [points[0].clone().addScaledVector(firstDirection, -18), ...points, points.at(-1).clone().addScaledVector(lastDirection, 20)];
}

function routeShape(points) {
  const corners = points.filter((point, index) => {
    if (index === 0 || index === points.length - 1) return true;
    const incoming = point.clone().sub(points[index - 1]).normalize();
    const outgoing = points[index + 1].clone().sub(point).normalize();
    return incoming.dot(outgoing) < .999999;
  });
  const lines = [];
  const bends = [];
  let offset = 0;
  for (let index = 0; index < corners.length - 1; index++) {
    const start = corners[index];
    const end = corners[index + 1];
    const length = start.distanceTo(end);
    const direction = end.clone().sub(start).normalize();
    lines.push({ start, direction, length, offset });
    offset += length;
    if (index + 1 < corners.length - 1) {
      const outgoing = corners[index + 2].clone().sub(end);
      const radius = Math.min(1.6, length * .4, outgoing.length() * .4);
      const before = end.clone().addScaledVector(direction, -radius);
      const after = end.clone().addScaledVector(outgoing.normalize(), radius);
      bends.push({ before, curve: new THREE.QuadraticBezierCurve3(before, end, after), start: offset - radius, end: offset + radius });
    }
  }
  return { corners, lines, bends };
}

function roundedRoute(points) {
  const shape = routeShape(points);
  const samples = [shape.corners[0]];
  for (const bend of shape.bends) {
    samples.push(bend.before, ...bend.curve.getPoints(12).slice(1));
  }
  samples.push(shape.corners.at(-1));
  return samples;
}

function motionPose(distance) {
  // Include the same straight lead-in added by extendedRoute.
  const offset = 18 + distance;
  const bend = motionShape.bends.find(part => offset >= part.start && offset <= part.end);
  if (bend) {
    const fraction = (offset - bend.start) / (bend.end - bend.start);
    return { position: bend.curve.getPoint(fraction), direction: bend.curve.getTangent(fraction) };
  }
  const line = motionShape.lines.find(part => offset < part.offset + part.length) ?? motionShape.lines.at(-1);
  return { position: line.start.clone().addScaledVector(line.direction, offset - line.offset), direction: line.direction };
}

function addRouteBand(points, leftOffset, rightOffset, height, material) {
  const positions = [];
  const uvs = [];
  const indices = [];
  let distance = 0;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangent = next.clone().sub(previous).normalize();
    const right = new THREE.Vector3(-tangent.z, 0, tangent.x);
    if (index) distance += point.distanceTo(previous);
    for (const offset of [leftOffset, rightOffset]) {
      const edge = point.clone().addScaledVector(right, offset);
      positions.push(edge.x, height, edge.z);
    }
    uvs.push(0, distance / 6, 1, distance / 6);
    if (index < points.length - 1) {
      const vertex = index * 2;
      indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function campusSignMaterial() {
  const map = canvasTexture(768, 320, (context, width, height) => {
    context.fillStyle = '#e6e0d2';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#183b66';
    context.font = '700 116px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('단국대학교', width / 2, 125);
    context.font = '500 45px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    context.fillText('죽전캠퍼스  ·  정문', width / 2, 232);
  });
  return new THREE.MeshStandardMaterial({ map, roughness: .9 });
}

function makeCampus(materials) {
  const campus = new THREE.Group();
  campus.position.copy(mapToWorld(plannedRoute.at(-1)));
  const stone = materials.stone;
  const navy = new THREE.MeshStandardMaterial({ color: '#244c73', roughness: .6, metalness: .1 });
  const lawn = materials.lawn;
  const sign = campusSignMaterial();
  addBox(campus, [43, .12, 37], [14, -.04, -3], materials.paving);
  addBox(campus, [13, .12, 7], [9, .05, -11], lawn);
  addBox(campus, [13, .12, 6], [11, .05, 10], lawn);
  for (const z of [-4.8, 4.8]) {
    addBox(campus, [1.1, 4.4, 1.15], [8.5, 2.2, z], stone, true);
    addBox(campus, [1.35, .2, 1.4], [8.5, 4.45, z], navy);
  }
  addBox(campus, [1, .95, 10.6], [8.5, 4.25, 0], navy, true);
  const gateName = new THREE.Mesh(new THREE.PlaneGeometry(8.3, .7), signMaterial('단국대학교', '#244c73'));
  gateName.rotation.y = -Math.PI / 2;
  gateName.position.set(7.98, 4.25, 0);
  campus.add(gateName);
  // Signs on both approaches make the campus visible after normal and recovery routes.
  addBox(campus, [.55, 2.9, 3.4], [6, 1.45, 4.6], stone, true);
  const eastSign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.4), sign);
  eastSign.rotation.y = -Math.PI / 2;
  eastSign.position.set(5.71, 1.9, 4.6);
  campus.add(eastSign);
  addBox(campus, [3.4, 2.9, .55], [4.1, 1.45, -6], stone, true);
  const northSign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.4), sign);
  northSign.position.set(4.1, 1.9, -5.71);
  campus.add(northSign);
  const blocks = [
    { center: [22, 6.5, -9], size: [13, 13, 25] },
    { center: [3, 5, -18], size: [15, 10, 9] }
  ];
  for (const block of blocks) {
    addBox(campus, block.size, block.center, stone, true);
    addBox(campus, [block.size[0] + .3, .35, block.size[2] + .3], [block.center[0], block.size[1] + .1, block.center[2]], navy);
    const facade = facadeMaterial('#d9d5c9', 4, { frame: '#3d4449' });
    const westFace = new THREE.Mesh(new THREE.PlaneGeometry(block.size[2], block.size[1]), facade);
    westFace.rotation.y = -Math.PI / 2;
    westFace.position.set(block.center[0] - block.size[0] / 2 - .015, block.center[1], block.center[2]);
    westFace.receiveShadow = true;
    campus.add(westFace);
    const southFace = new THREE.Mesh(new THREE.PlaneGeometry(block.size[0], block.size[1]), facade);
    southFace.position.set(block.center[0], block.center[1], block.center[2] + block.size[2] / 2 + .015);
    southFace.receiveShadow = true;
    campus.add(southFace);
  }
  const buildingName = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.1), signMaterial('단국대학교', '#244c73'));
  buildingName.rotation.y = -Math.PI / 2;
  buildingName.position.set(15.46, 10.4, -9);
  campus.add(buildingName);
  for (const z of [-7, 7]) {
    addBox(campus, [3.8, .45, .6], [3.3, .35, z], materials.bark, true);
    addBox(campus, [3.8, .6, .12], [3.3, .8, z + .25], materials.bark, true);
  }
  scene.add(campus);
  scenery.dataset.campus = '단국대학교';
}

// 거리 밖을 채우는 원경 아파트 단지. 하나의 InstancedMesh라 그리기 비용이 거의 없다.
function makeSkyline(material) {
  const blocks = [];
  let attempts = 0;
  while (blocks.length < 24 && attempts < 800) {
    attempts++;
    const angle = random() * Math.PI * 2;
    const radius = 125 + random() * 110;
    const x = 6 + Math.cos(angle) * radius;
    const z = -22 + Math.sin(angle) * radius;
    if (blocks.some(block => Math.hypot(block[0] - x, block[1] - z) < 34)) continue;
    blocks.push([x, z]);
  }
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, .5, 0);
  const skyline = new THREE.InstancedMesh(geometry, material, blocks.length);
  const transform = new THREE.Object3D();
  blocks.forEach(([x, z], index) => {
    const height = 38 + random() * 22;
    transform.position.set(x, 0, z);
    transform.scale.set(30 + random() * 8, height, 11);
    transform.rotation.y = Math.atan2(6 - x, -22 - z) + (random() - .5) * .5;
    transform.updateMatrix();
    skyline.setMatrixAt(index, transform.matrix);
  });
  scene.add(skyline);
}

function makeCityRoute(materials, signs) {
  const groundMaterial = materials.paving.clone();
  groundMaterial.map = materials.paving.map.clone();
  groundMaterial.map.repeat.set(380, 380);
  groundMaterial.bumpMap = materials.paving.bumpMap.clone();
  groundMaterial.bumpMap.repeat.set(380, 380);
  addBox(scene, [560, .16, 560], [0, -.08, -25], groundMaterial);
  const points = plannedRoute.map(mapToWorld);
  const road = roundedRoute(extendedRoute(points));
  addRouteBand(road, 1.7, 3.15, .022, materials.walkway);
  addRouteBand(road, -1.6, 1.6, .04, materials.cycle);
  addRouteBand(road, -1.59, -1.53, .046, materials.yellow);
  addRouteBand(road, 1.6, 1.66, .046, materials.line);
  addBox(scene, [9.3, .08, 65], [8.15, -.025, 5], materials.asphalt);
  for (let z = -24; z < 38; z += 6) addBox(scene, [.12, .012, 2.6], [8, .024, z], materials.line);
  for (const x of [3.7, 12.6]) addBox(scene, [.1, .012, 65], [x, .024, 5], materials.line);
  for (let z = -25; z < 36; z += 3) addBox(scene, [.055, 1.03, .055], [3.47, .57, z], materials.metal, true);
  for (const y of [.4, .95]) addBox(scene, [.055, .055, 62], [3.47, y, 5], materials.metal, true);
  const street = new THREE.Group();
  makeTrees(street, materials);
  makeLamp(street, -7.1, -7, materials.metal);
  makeLamp(street, -7.1, -27, materials.metal);
  const colors = ['#c8c2b4', '#d6d0c3', '#a9b1b3', '#bfb4a4', '#cfc9be'];
  for (let index = 0; index < 5; index++) {
    const z = 5 - index * 12;
    makeBuilding(street, -1, z, 13 + random() * 12, colors[index % colors.length], signs[index % signs.length], materials);
    if (z > -20) makeBuilding(street, 1, z, 16 + random() * 13, colors[(index + 1) % colors.length], signs[(index + 2) % signs.length], materials);
  }
  scene.add(street);
  for (let index = 0; index < points.length - 1; index++) {
    const tangent = points[index + 1].clone().sub(points[index]);
    if (tangent.length() < 5) continue;
    const point = points[index].clone().lerp(points[index + 1], .5);
    const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    point.addScaledVector(right, -.65);
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.6), materials.bicycle);
    const heading = Math.atan2(-tangent.x, -tangent.z);
    mark.rotation.set(-Math.PI / 2, heading, 0, 'YXZ');
    mark.position.set(point.x, .05, point.z);
    mark.receiveShadow = true;
    scene.add(mark);
  }
  makeCampus(materials);
  makeSkyline(materials.apartment);
}

function makeCar(x, z, color, materials) {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: .22, metalness: .55 });
  addBox(car, [1.78, .5, 4.3], [0, .55, 0], paint);
  addBox(car, [1.72, .16, 4.18], [0, .86, 0], paint);
  addBox(car, [1.5, .5, 2.15], [0, 1.18, -.2], materials.carGlass);
  addBox(car, [1.44, .07, 1.75], [0, 1.45, -.25], paint);
  addBox(car, [1.82, .14, 4.34], [0, .36, 0], materials.rubber);
  for (const lightX of [-.62, .62]) {
    addBox(car, [.38, .12, .04], [lightX, .72, 2.16], materials.headlight);
    addBox(car, [.38, .12, .04], [lightX, .74, -2.16], materials.taillight);
  }
  for (const wheelX of [-.84, .84]) {
    for (const wheelZ of [-1.35, 1.35]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, .22, 18), materials.rubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wheelX, .32, wheelZ);
      car.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .23, 12), materials.metal);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(wheelX, .32, wheelZ);
      car.add(hub);
    }
  }
  // 그림자맵은 정적이라 움직이는 차는 부드러운 접지 그림자를 함께 가지고 다닌다.
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5), materials.contactShadow);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = .02;
  car.add(contact);
  car.position.set(x, 0, z);
  car.userData.startZ = z;
  scene.add(car);
  traffic.push(car);
}

/* ---------- 하늘 ---------- */

function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      sunDirection: { value: sunDirection },
      horizonColor: { value: horizonColor },
      zenithColor: { value: zenithColor }
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        vec4 clip = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0);
        gl_Position = clip.xyww;
      }`,
    fragmentShader: `
      uniform vec3 sunDirection;
      uniform vec3 horizonColor;
      uniform vec3 zenithColor;
      varying vec3 vDirection;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float value = 0.0; float amplitude = 0.5;
        for (int i = 0; i < 5; i++) { value += amplitude * noise(p); p = p * 2.03 + 17.0; amplitude *= 0.5; }
        return value;
      }
      float ridge(float azimuth, float scale, float seed) {
        return fbm(vec2(azimuth * scale + seed, seed));
      }
      void main() {
        vec3 direction = normalize(vDirection);
        float h = direction.y;
        float up = max(h, 0.0);
        vec3 color = mix(horizonColor, zenithColor, pow(up, 0.55));
        color = mix(color, horizonColor * vec3(0.93, 0.95, 0.97), smoothstep(0.0, -0.08, h));
        float sun = max(dot(direction, sunDirection), 0.0);
        color += vec3(1.0, 0.9, 0.72) * (pow(sun, 6.0) * 0.16 + pow(sun, 60.0) * 0.45);
        color += vec3(1.0, 0.97, 0.9) * smoothstep(0.99955, 0.99975, sun) * 18.0;
        // 맑은 날의 옅은 적운
        if (h > 0.015) {
          vec2 uv = direction.xz / (h + 0.09) * 0.9;
          float density = fbm(uv * 1.15 + vec2(3.1, 7.4));
          float cloud = smoothstep(0.6, 0.82, density) * smoothstep(0.015, 0.16, h);
          float lit = 0.82 + 0.25 * fbm(uv * 2.3 + sunDirection.xz * 0.6);
          vec3 cloudColor = mix(vec3(0.62, 0.68, 0.76), vec3(1.0, 0.99, 0.97), clamp(lit + pow(sun, 4.0) * 0.3, 0.0, 1.0));
          color = mix(color, cloudColor, cloud * 0.92);
        }
        // 서울 근교 특유의 원경 산 능선 두 겹, 대기 원근으로 하늘에 녹아든다.
        float azimuth = atan(direction.x, direction.z);
        float far = 0.028 + 0.05 * ridge(azimuth, 2.2, 4.0);
        float near = 0.012 + 0.036 * ridge(azimuth, 3.6, 11.0);
        vec3 farColor = mix(horizonColor, vec3(0.43, 0.53, 0.62), 0.42);
        vec3 nearColor = mix(horizonColor, vec3(0.3, 0.4, 0.42), 0.55);
        float farMask = smoothstep(far + 0.002, far - 0.002, h) * step(-0.02, h);
        float nearMask = smoothstep(near + 0.002, near - 0.002, h) * step(-0.02, h);
        color = mix(color, mix(farColor, horizonColor, smoothstep(far, -0.01, h) * 0.5), farMask);
        color = mix(color, mix(nearColor, horizonColor, smoothstep(near, -0.01, h) * 0.55), nearMask);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
}

function makeSky() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

function initializeScenery() {
  renderer = new THREE.WebGLRenderer({ canvas: scenery, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // 거리 풍경은 움직이지 않으므로 그림자는 한 번만 계산해 프레임 부담을 없앤다.
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  scene = new THREE.Scene();
  scene.background = horizonColor.clone();
  scene.add(makeSky());

  // 하늘을 환경광으로 구워 유리·차체·금속에 하늘이 비치게 한다.
  const environmentScene = new THREE.Scene();
  environmentScene.add(makeSky());
  const environmentGround = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: '#8d8a80' }));
  environmentGround.rotation.x = -Math.PI / 2;
  environmentGround.position.y = -1.6;
  environmentScene.add(environmentGround);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environmentScene, .02).texture;
  pmrem.dispose();

  scene.fog = new THREE.FogExp2(horizonColor.clone(), .0058);
  camera = new THREE.PerspectiveCamera(62, 1, .1, 420);
  camera.position.set(0, 1.65, 0);
  camera.rotation.set(-.03, 0, 0, 'YXZ');
  scene.add(new THREE.HemisphereLight('#dbe7f2', '#a39577', .45));
  scene.environmentIntensity = .55;
  const sunlight = new THREE.DirectionalLight('#fff1db', 4.2);
  sunlight.target.position.set(6, 0, -22);
  sunlight.position.copy(sunlight.target.position).addScaledVector(sunDirection, 90);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunlight.shadow.camera, { left: -62, right: 62, top: 62, bottom: -62, near: 10, far: 190 });
  sunlight.shadow.camera.updateProjectionMatrix();
  sunlight.shadow.normalBias = .04;
  sunlight.shadow.bias = -.00015;
  sunlight.shadow.radius = 2.5;
  scene.add(sunlight, sunlight.target);

  const cycleMaps = asphaltMaps('#a85a50', { speckle: .16, wear: .3, contrast: .26 });
  const asphalt = asphaltMaps('#5d6266', { speckle: .3, wear: .12 });
  const walkway = pavingMaps('#a9a69b', 5, 12);
  const paving = pavingMaps('#cdc5b5', 4, 8);
  const lawnMap = grassMaps('#6f8a4c');
  const soilMap = grassMaps('#86765f');
  const stoneMaps = asphaltMaps('#d2ccbd', { speckle: .08, wear: .05, contrast: .12 });
  const materials = {
    cycle: new THREE.MeshStandardMaterial({ map: finishTexture(cycleMaps.map, 1, 2), bumpMap: finishTexture(cycleMaps.bumpMap, 1, 2), bumpScale: 1.2, roughness: .88 }),
    walkway: new THREE.MeshStandardMaterial({ map: finishTexture(walkway.map, 1, 2), bumpMap: finishTexture(walkway.bumpMap, 1, 2), bumpScale: 1.5, roughness: .92 }),
    paving: new THREE.MeshStandardMaterial({ map: finishTexture(paving.map, 30, 26), bumpMap: finishTexture(paving.bumpMap, 30, 26), bumpScale: 1.5, roughness: .9 }),
    asphalt: new THREE.MeshStandardMaterial({ map: finishTexture(asphalt.map, 2, 14), bumpMap: finishTexture(asphalt.bumpMap, 2, 14), bumpScale: 1.2, roughness: .85 }),
    curb: new THREE.MeshStandardMaterial({ map: finishTexture(stoneMaps.map.clone(), 1, 1), color: '#e2ddd0', roughness: .85 }),
    line: new THREE.MeshStandardMaterial({ color: '#f1ede0', roughness: .6 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#e0b84a', roughness: .6 }),
    metal: new THREE.MeshStandardMaterial({ color: '#56625f', roughness: .45, metalness: .6 }),
    bark: new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: .95 }),
    soil: new THREE.MeshStandardMaterial({ map: finishTexture(soilMap, 1, 1), roughness: 1 }),
    lawn: new THREE.MeshStandardMaterial({ map: finishTexture(lawnMap, 4, 3), roughness: 1 }),
    stone: new THREE.MeshStandardMaterial({ map: finishTexture(stoneMaps.map, 2, 2), bumpMap: finishTexture(stoneMaps.bumpMap, 2, 2), bumpScale: .8, roughness: .8 }),
    leaf: new THREE.MeshStandardMaterial({ map: foliageTexture(), alphaTest: .45, side: THREE.DoubleSide, roughness: .75 }),
    glass: new THREE.MeshStandardMaterial({ color: '#647e8d', roughness: .1, metalness: .3 }),
    carGlass: new THREE.MeshStandardMaterial({ color: '#1c252b', roughness: .05, metalness: .2 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#22272a', roughness: .9 }),
    headlight: new THREE.MeshStandardMaterial({ color: '#f4f2ea', emissive: '#6e6a5e', roughness: .1 }),
    taillight: new THREE.MeshStandardMaterial({ color: '#a3161a', emissive: '#3a0506', roughness: .2 }),
    roof: new THREE.MeshStandardMaterial({ color: '#8e918c', roughness: .95 }),
    roofUnit: new THREE.MeshStandardMaterial({ color: '#c9cbc6', roughness: .7, metalness: .2 }),
    awning: new THREE.MeshStandardMaterial({ color: '#3d4a50', roughness: .6, metalness: .3 }),
    contactShadow: new THREE.MeshBasicMaterial({ map: softShadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    apartment: apartmentMaterial(),
    bicycle: bicycleMarkMaterial()
  };
  const signs = [signMaterial('카페 봄', '#866a58'), signMaterial('성현약국', '#3f7d62'), signMaterial('동네서점', '#3f6683'), signMaterial('편의점', '#5f7046')];
  makeCityRoute(materials, signs);
  makeCar(6, -5, '#e8eaea', materials);
  makeCar(10, -16, '#5d7180', materials);
  makeCar(6, -25, '#2b2f33', materials);
  renderer.shadowMap.needsUpdate = true;
  scenery.dataset.scene = 'urban-cycleway';
  resizeScenery();
}

function renderScenery() {
  for (const car of traffic) {
    car.position.z = ((car.userData.startZ + distanceTravelled * .4 + 27) % 67 + 67) % 67 - 27;
  }
  const effort = reducedMotion.matches ? 0 : Math.min(currentSpeed / 1.8, 1);
  const bob = Math.sin(pedalPhase * 2) * .0045 * effort;
  const sway = Math.sin(pedalPhase) * .003 * effort;
  const lean = reducedMotion.matches ? 0 : currentLean;
  camera.position.set(currentPosition.x + Math.cos(currentHeading) * sway, 1.65 + bob, currentPosition.z - Math.sin(currentHeading) * sway);
  camera.rotation.set(-.03 + bob * .08, currentHeading, lean * .3, 'YXZ');
  bicycle.style.setProperty('--ride-lift', (Math.sin(pedalPhase * 2 + .25) * .65 * effort).toFixed(3) + 'px');
  bicycle.style.setProperty('--ride-sway', (Math.sin(pedalPhase) * .35 * effort).toFixed(3) + 'px');
  bicycle.style.setProperty('--ride-lean', (-THREE.MathUtils.radToDeg(lean) * .55).toFixed(3) + 'deg');
  renderer.render(scene, camera);
  scenery.dataset.distance = distanceTravelled.toFixed(2);
  scenery.dataset.heading = THREE.MathUtils.radToDeg(currentHeading).toFixed(1);
  scenery.dataset.speed = currentSpeed.toFixed(2);
  scenery.dataset.lean = THREE.MathUtils.radToDeg(lean).toFixed(2);
}

function animateScenery(now) {
  if (!moving) return;
  const delta = previousTime ? Math.min((now - previousTime) / 1000, .05) : 0;
  previousTime = now;
  const previousPosition = currentPosition.clone();
  currentPosition.lerp(targetPosition, 1 - Math.exp(-22 * delta));
  const measuredSpeed = delta ? currentPosition.distanceTo(previousPosition) / delta : currentSpeed;
  currentSpeed = THREE.MathUtils.lerp(currentSpeed, measuredSpeed, 1 - Math.exp(-7 * delta));
  const angle = Math.atan2(Math.sin(targetHeading - currentHeading), Math.cos(targetHeading - currentHeading));
  const headingChange = angle * (1 - Math.exp(-12 * delta));
  currentHeading += headingChange;
  const turnRate = delta ? headingChange / delta : 0;
  const targetLean = THREE.MathUtils.clamp(turnRate * currentSpeed * .02, -.035, .035);
  currentLean = THREE.MathUtils.lerp(currentLean, targetLean, 1 - Math.exp(-6 * delta));
  pedalPhase += delta * Math.PI * 2 * (.6 + .3 * Math.min(currentSpeed / 1.8, 1));
  renderScenery();
  animationFrame = requestAnimationFrame(animateScenery);
}

function resizeScenery() {
  if (!renderer || !desktopScenery.matches) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderScenery();
}

function syncRideScenery() {
  if (desktopScenery.matches && !renderer) initializeScenery();
  moving = desktopScenery.matches && !document.hidden && ridingPhone.dataset.pedaling === 'true';
  if (ridingPhone.dataset.stage === 'home') {
    distanceTravelled = 0;
    targetPosition.set(0, 0, 0);
    currentPosition.copy(targetPosition);
    targetHeading = currentHeading = 0;
    currentSpeed = currentLean = pedalPhase = 0;
    scenery.dataset.mapPosition = plannedRoute[0].join(',');
  }
  if (ridingPhone.dataset.stage === 'arrived') {
    currentPosition.copy(targetPosition);
    currentHeading = targetHeading;
    currentSpeed = currentLean = 0;
  }
  if (!moving) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    previousTime = 0;
    if (renderer && desktopScenery.matches) renderScenery();
    return;
  }
  if (!animationFrame) {
    previousTime = 0;
    animationFrame = requestAnimationFrame(animateScenery);
  }
}

scenery.addEventListener('ride-progress', event => {
  const { position, route, distance } = event.detail;
  if (motionRoute !== route) {
    motionRoute = route;
    motionShape = routeShape(extendedRoute(route.map(mapToWorld)));
  }
  const pose = motionPose(distance * sceneScale);
  const lookAhead = motionPose(distance * sceneScale + .24);
  distanceTravelled += targetPosition.distanceTo(pose.position);
  targetPosition.copy(pose.position);
  targetHeading = Math.atan2(-lookAhead.direction.x, -lookAhead.direction.z);
  scenery.dataset.mapPosition = position.join(',');
});

new MutationObserver(syncRideScenery).observe(ridingPhone, { attributes: true, attributeFilter: ['data-pedaling', 'data-stage'] });
desktopScenery.addEventListener('change', () => { syncRideScenery(); resizeScenery(); });
window.addEventListener('resize', resizeScenery);
document.addEventListener('visibilitychange', syncRideScenery);
scenery.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
});
scenery.addEventListener('webglcontextrestored', () => {
  if (renderer) renderer.shadowMap.needsUpdate = true;
  resizeScenery();
  syncRideScenery();
});
syncRideScenery();
