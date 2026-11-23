import * as THREE from './assets/three.module.min.js';

const scenery = document.getElementById('rideScenery');
const ridingPhone = document.getElementById('phone');
const desktopScenery = window.matchMedia('(min-width:701px)');
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

// A fixed seed keeps the streetscape consistent between test sessions.
let randomSeed = 41721;
function random() {
  randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
  return randomSeed / 4294967296;
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function surfaceTexture(color, paving = false) {
  const texture = canvasTexture(512, 512, (context, width, height) => {
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    for (let index = 0; index < 7000; index++) {
      context.fillStyle = random() > .5 ? 'rgba(255,255,255,.065)' : 'rgba(0,0,0,.06)';
      context.fillRect(random() * width, random() * height, 1 + random() * 2, 1 + random() * 2);
    }
    if (paving) {
      context.strokeStyle = '#a8a799';
      context.lineWidth = 1.5;
      for (let row = 0; row <= 8; row++) {
        const y = row * 64;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
        for (let column = -1; column < 5; column++) {
          const x = column * 128 + (row % 2) * 64;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x, y + 64);
          context.stroke();
        }
      }
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(paving ? 2 : 1, 8);
  texture.anisotropy = 4;
  return texture;
}

function addBox(parent, dimensions, position, material, castShadow = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function facadeTexture(color, floors) {
  return canvasTexture(512, 1024, (context, width, height) => {
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    const rowHeight = 820 / floors;
    for (let row = 0; row < floors; row++) {
      const y = 20 + row * rowHeight;
      context.fillStyle = 'rgba(255,255,255,.35)';
      context.fillRect(0, y + rowHeight - 7, width, 5);
      for (let column = 0; column < 5; column++) {
        const x = 20 + column * 100;
        const reflection = context.createLinearGradient(0, y, 0, y + rowHeight);
        reflection.addColorStop(0, '#8fa9b6');
        reflection.addColorStop(.55, random() > .4 ? '#506775' : '#73818a');
        reflection.addColorStop(1, '#b2bfc1');
        context.fillStyle = '#d5d5d0';
        context.fillRect(x - 3, y - 3, 78, rowHeight - 13);
        context.fillStyle = reflection;
        context.fillRect(x, y, 72, rowHeight - 19);
        context.fillStyle = 'rgba(231,239,238,.45)';
        context.fillRect(x + 34, y, 2, rowHeight - 19);
      }
    }
    context.fillStyle = '#b5b6af';
    context.fillRect(0, 850, width, 174);
    for (let column = 0; column < 4; column++) {
      context.fillStyle = '#3b5056';
      context.fillRect(15 + column * 128, 878, 102, 140);
      context.fillStyle = '#97aeb4';
      context.fillRect(21 + column * 128, 884, 90, 78);
    }
  });
}

function signMaterial(text, color) {
  const map = canvasTexture(512, 112, (context, width, height) => {
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#fffdf5';
    context.font = '700 58px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2 + 4);
  });
  return new THREE.MeshStandardMaterial({ map, roughness: .85 });
}

function makeBuilding(parent, side, z, height, color, sign) {
  const depth = 7;
  const width = 9 + random() * 2;
  const x = side < 0 ? -18 : 21.5;
  const wall = new THREE.MeshStandardMaterial({ color, roughness: .92 });
  addBox(parent, [depth, height, width], [x, height / 2, z], wall, true);
  const frontX = x - side * (depth / 2 + .015);
  const facade = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: facadeTexture(color, Math.round(height / 3)), roughness: .65 })
  );
  facade.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  facade.position.set(frontX, height / 2, z);
  facade.receiveShadow = true;
  parent.add(facade);
  addBox(parent, [depth + .15, .25, width + .2], [x, height + .1, z], wall);
  const shopSign = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1), sign);
  shopSign.rotation.y = facade.rotation.y;
  shopSign.position.set(frontX - side * .04, 3.1, z);
  parent.add(shopSign);
}

function foliageTexture() {
  return canvasTexture(128, 128, (context) => {
    for (let leaf = 0; leaf < 150; leaf++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * 49;
      const shade = Math.round(180 + random() * 75);
      context.fillStyle = `rgb(${shade},${shade},${shade})`;
      context.beginPath();
      context.ellipse(64 + Math.cos(angle) * radius, 64 + Math.sin(angle) * radius, 3 + random() * 5, 1.5 + random() * 2.5, random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
  });
}

function makeTrees(parent, materials) {
  const positions = [];
  for (let index = 0; index < 4; index++) {
    positions.push([-7.4, -4 - index * 12]);
    positions.push([14.5, -10 - index * 12]);
  }
  const leafGeometry = new THREE.PlaneGeometry(1, 1);
  const leaves = new THREE.InstancedMesh(leafGeometry, materials.leaf, positions.length * 150);
  const transform = new THREE.Object3D();
  const palette = ['#577441', '#68834b', '#809452', '#93a45c', '#a5ad64'];
  let instance = 0;
  for (const [x, z] of positions) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.12, .22, 4.2, 8), materials.bark);
    trunk.position.set(x, 2.1, z);
    trunk.castShadow = true;
    parent.add(trunk);
    addBox(parent, [1.4, .14, 1.9], [x, .12, z], materials.soil);
    for (let branch = 0; branch < 3; branch++) {
      const angle = branch * Math.PI * 2 / 3;
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(.065, .11, 1.6, 6), materials.bark);
      limb.position.set(x + Math.cos(angle) * .38, 3.7, z + Math.sin(angle) * .38);
      limb.rotation.z = Math.cos(angle) * .65;
      limb.rotation.x = Math.sin(angle) * .65;
      parent.add(limb);
    }
    for (let cluster = 0; cluster < 150; cluster++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * 1.75;
      transform.position.set(x + Math.cos(angle) * radius, 4.2 + random() * 1.8, z + Math.sin(angle) * radius);
      const leafScale = .7 + random() * .6;
      transform.scale.setScalar(leafScale);
      transform.rotation.set(random(), random(), random());
      transform.updateMatrix();
      leaves.setMatrixAt(instance, transform.matrix);
      leaves.setColorAt(instance, new THREE.Color(palette[Math.floor(random() * palette.length)]));
      instance++;
    }
  }
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  parent.add(leaves);
}

function makeLamp(parent, x, z, material) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.045, .075, 6.5, 8), material);
  pole.position.set(x, 3.25, z);
  parent.add(pole);
  addBox(parent, [1.6, .07, .07], [x + .7, 6.45, z], material);
  addBox(parent, [.6, .08, .22], [x + 1.45, 6.42, z], material);
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
  });
  return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
}

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
  const stone = new THREE.MeshStandardMaterial({ color: '#d6d0c1', roughness: .95 });
  const navy = new THREE.MeshStandardMaterial({ color: '#244c73', roughness: .8 });
  const lawn = new THREE.MeshStandardMaterial({ color: '#839871', roughness: 1 });
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
    const facade = new THREE.MeshStandardMaterial({ map: facadeTexture('#d9d5c9', 4), roughness: .7 });
    const westFace = new THREE.Mesh(new THREE.PlaneGeometry(block.size[2], block.size[1]), facade);
    westFace.rotation.y = -Math.PI / 2;
    westFace.position.set(block.center[0] - block.size[0] / 2 - .015, block.center[1], block.center[2]);
    campus.add(westFace);
    const southFace = new THREE.Mesh(new THREE.PlaneGeometry(block.size[0], block.size[1]), facade);
    southFace.position.set(block.center[0], block.center[1], block.center[2] + block.size[2] / 2 + .015);
    campus.add(southFace);
  }
  const buildingName = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.1), signMaterial('단국대학교', '#244c73'));
  buildingName.rotation.y = -Math.PI / 2;
  buildingName.position.set(15.46, 10.4, -9);
  campus.add(buildingName);
  for (const z of [-7, 7]) {
    addBox(campus, [3.8, .45, .6], [3.3, .35, z], materials.bark);
    addBox(campus, [3.8, .6, .12], [3.3, .8, z + .25], materials.bark);
  }
  scene.add(campus);
  scenery.dataset.campus = '단국대학교';
}

function makeCityRoute(materials, signs) {
  const groundMaterial = materials.paving.clone();
  groundMaterial.map = materials.paving.map.clone();
  groundMaterial.map.repeat.set(45, 45);
  groundMaterial.map.needsUpdate = true;
  addBox(scene, [180, .16, 180], [0, -.08, -25], groundMaterial);
  const points = plannedRoute.map(mapToWorld);
  const road = roundedRoute(extendedRoute(points));
  addRouteBand(road, 1.7, 3.15, .022, materials.walkway);
  addRouteBand(road, -1.6, 1.6, .04, materials.cycle);
  addRouteBand(road, -1.59, -1.53, .046, materials.yellow);
  addRouteBand(road, 1.6, 1.66, .046, materials.line);
  addBox(scene, [9.3, .08, 65], [8.15, -.025, 5], materials.asphalt);
  for (let z = -24; z < 38; z += 6) addBox(scene, [.08, .012, 2.3], [8, .024, z], materials.line);
  for (let z = -25; z < 36; z += 3) addBox(scene, [.055, 1.03, .055], [3.47, .57, z], materials.metal);
  for (const y of [.4, .95]) addBox(scene, [.055, .055, 62], [3.47, y, 5], materials.metal);
  const street = new THREE.Group();
  makeTrees(street, materials);
  makeLamp(street, -7.1, -7, materials.metal);
  makeLamp(street, -7.1, -27, materials.metal);
  const colors = ['#c8c6bb', '#d3cfc3', '#acb5b7', '#bdc2c1'];
  for (let index = 0; index < 5; index++) {
    const z = 5 - index * 12;
    makeBuilding(street, -1, z, 13 + random() * 12, colors[index % colors.length], signs[index % signs.length]);
    if (z > -20) makeBuilding(street, 1, z, 16 + random() * 13, colors[(index + 1) % colors.length], signs[(index + 2) % signs.length]);
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
    scene.add(mark);
  }
  makeCampus(materials);
}

function makeCar(x, z, color, materials) {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: .4, metalness: .15 });
  addBox(car, [1.65, .55, 3.6], [0, .65, 0], paint, true);
  addBox(car, [1.35, .53, 1.85], [0, 1.15, -.15], materials.glass);
  addBox(car, [1.4, .07, 1.9], [0, 1.44, -.15], paint);
  for (const wheelX of [-.84, .84]) {
    for (const wheelZ of [-1.15, 1.15]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.29, .29, .18, 12), materials.rubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wheelX, .32, wheelZ);
      car.add(wheel);
    }
  }
  car.position.set(x, 0, z);
  car.userData.startZ = z;
  scene.add(car);
  traffic.push(car);
}

function initializeScenery() {
  renderer = new THREE.WebGLRenderer({ canvas: scenery, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  scene = new THREE.Scene();
  scene.background = canvasTexture(1024, 1024, (context, width, height) => {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#92b6d0');
    gradient.addColorStop(.58, '#d4e1e7');
    gradient.addColorStop(1, '#e7e8e0');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  });
  scene.fog = new THREE.FogExp2('#d7e0df', .0135);
  camera = new THREE.PerspectiveCamera(62, 1, .1, 190);
  camera.position.set(0, 1.65, 0);
  camera.rotation.set(-.03, 0, 0, 'YXZ');
  scene.add(new THREE.HemisphereLight('#d8e8f4', '#a5a18c', 2.1));
  const sunlight = new THREE.DirectionalLight('#fff2d7', 2.5);
  sunlight.position.set(-28, 40, -20);
  sunlight.target.position.set(0, 0, -25);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  Object.assign(sunlight.shadow.camera, { left: -34, right: 34, top: 45, bottom: -40, near: 1, far: 120 });
  sunlight.shadow.camera.updateProjectionMatrix();
  sunlight.shadow.normalBias = .035;
  sunlight.shadow.bias = -.0001;
  scene.add(sunlight, sunlight.target);
  const materials = {
    cycle: new THREE.MeshStandardMaterial({ map: surfaceTexture('#b67577'), roughness: 1 }),
    walkway: new THREE.MeshStandardMaterial({ map: surfaceTexture('#849c87'), roughness: 1 }),
    paving: new THREE.MeshStandardMaterial({ map: surfaceTexture('#d4d0c4', true), roughness: 1 }),
    asphalt: new THREE.MeshStandardMaterial({ map: surfaceTexture('#626a6e'), roughness: 1 }),
    curb: new THREE.MeshStandardMaterial({ color: '#c5c5b9', roughness: 1 }),
    line: new THREE.MeshStandardMaterial({ color: '#eee9d7', roughness: 1 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#d6bd63', roughness: 1 }),
    metal: new THREE.MeshStandardMaterial({ color: '#49595a', roughness: .65, metalness: .35 }),
    bark: new THREE.MeshStandardMaterial({ color: '#736353', roughness: 1 }),
    soil: new THREE.MeshStandardMaterial({ color: '#6e7661', roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({ map: foliageTexture(), alphaTest: .5, side: THREE.DoubleSide, roughness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: '#647e8d', roughness: .3, metalness: .3 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#31373a', roughness: 1 }),
    bicycle: bicycleMarkMaterial()
  };
  const signs = [signMaterial('카페 봄', '#866a58'), signMaterial('성현약국', '#5c8572'), signMaterial('동네서점', '#506f83'), signMaterial('편의점', '#6e765b')];
  makeCityRoute(materials, signs);
  makeCar(6, -5, '#e3e6e5', materials);
  makeCar(10, -16, '#7c909a', materials);
  makeCar(6, -25, '#bcc7ce', materials);
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
scenery.addEventListener('webglcontextrestored', () => { resizeScenery(); syncRideScenery(); });
syncRideScenery();
