import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import {
  AVATAR_RADIUS,
  CENTER,
  FLOOR_RADIUS,
  FRAME_WIDTH,
  RING_RADIUS,
  computePositions,
  toWorld,
} from "../graphLayout.js";
import { FALLBACK_AVATAR_URL, avatarUrl } from "../people.js";

// Colours mirror the CSS custom properties in styles.css.
const COLOR = {
  primary: 0xe2674f,
  glow: 0xf5b041,
  d1: 0x8a5a44,
  d2: 0xb28a73,
  edge: 0xeda36a,
  orbit: 0xe3cdbd,
  floorRim: 0xecdccf,
  dimmedFrame: 0xd2c7bf,
  avatarBack: 0xead7c8,
  avatarBg: "#f6e3d8",
};

const STAND_GAP = 0.12;
const LIFT = 0.18;
const PULSE_SECONDS = 2.4;

// The camera orbits horizontally around the floor centre, looking down at
// CAMERA_ELEVATION degrees: lower is more level, higher shows more of the floor.
const CAMERA_ELEVATION = 15;
const FOV = 38;
// Orbiting the exact centre keeps the circular floor's outline still on screen while rotating.
const TARGET = new THREE.Vector3(0, 0.5, 0);
// Closest the camera may get, to limit perspective distortion on wide screens.
const MIN_CAMERA_DISTANCE = 9;
const MAX_CAMERA_DISTANCE = 40;
// Pixels kept clear between the scene and the viewport edges (top leaves room for the controls).
const FRAME_MARGIN = { top: 48, bottom: 24, side: 16 };
// Highest point of an outer-ring person, name label included, in world units.
const OUTER_CONTENT_TOP = 2;
const HOME_DIRECTION = new THREE.Vector3(
  0,
  Math.sin(THREE.MathUtils.degToRad(CAMERA_ELEVATION)),
  Math.cos(THREE.MathUtils.degToRad(CAMERA_ELEVATION)),
);
const CLICK_TOLERANCE_PX = 5;
const DIMMED_FILTER = "grayscale(0.85) contrast(0.7) brightness(1.12)";

// Imperative three.js scene for the relationship graph. React owns the data and the
// selection; this class only draws them and reports pointer interaction back.
export class GraphScene {
  constructor(container, { onSelect, onBackgroundClick, onViewChange }) {
    this.container = container;
    this.callbacks = { onSelect, onBackgroundClick, onViewChange };
    this.disposables = new Set();
    this.lineMaterials = [];
    this.people = new Map();
    this.pickTargets = [];
    this.appearance = { matchedIds: new Set(), filterActive: false, selectedId: null, focusedId: null };
    this.hoveredId = null;
    this.pendingYaw = 0;
    this.disposed = false;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Throws when WebGL is unavailable; the caller shows a plain list instead.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = "graph-canvas";
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "graph-labels";
    container.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    this.cameraDistance = MIN_CAMERA_DISTANCE;
    this.camera.position.copy(this.homePosition());

    this.controls = this.createControls();
    this.addLights();
    this.addFloor();

    this.bindPointerEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  createControls() {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.copy(TARGET);
    controls.enablePan = false;
    // Zoom stays off so the mouse wheel keeps scrolling the page.
    controls.enableZoom = false;
    controls.enableDamping = !this.reducedMotion;
    controls.rotateSpeed = 0.7;
    // Locking the polar angle allows left/right rotation only.
    const polar = new THREE.Spherical().setFromVector3(HOME_DIRECTION).phi;
    controls.minPolarAngle = polar;
    controls.maxPolarAngle = polar;
    controls.update();
    // Let vertical swipes scroll the page on touch screens; horizontal swipes rotate.
    this.renderer.domElement.style.touchAction = "pan-y";
    controls.addEventListener("change", () => this.callbacks.onViewChange?.());
    return controls;
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff4e8, 0xd9b9a0, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-5, 10, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
    sun.shadow.radius = 4;
    this.scene.add(sun);
  }

  addFloor() {
    const geometry = this.track(new THREE.CircleGeometry(FLOOR_RADIUS, 96));
    // Translucent white floor, with a separate shadow-only layer so shadows stay visible.
    const floor = new THREE.Mesh(
      geometry,
      this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.55 })),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const shadows = new THREE.Mesh(geometry, this.track(new THREE.ShadowMaterial({ opacity: 0.16 })));
    shadows.rotation.x = -Math.PI / 2;
    shadows.position.y = 0.002;
    shadows.receiveShadow = true;
    this.scene.add(shadows);

    this.scene.add(this.makeLine(circlePoints(new THREE.Vector3(), FLOOR_RADIUS, 0.004), { color: COLOR.floorRim, width: 1.5 }));
  }

  // Builds the people, edges and orbit guides. Called once per network.
  setGraph(nodes, edges) {
    const positions = computePositions(nodes);
    const origin = new THREE.Vector3();
    this.scene.add(this.makeLine(circlePoints(origin, toWorld(RING_RADIUS[1]), 0.006), { color: COLOR.orbit, width: 1.5 }));
    this.scene.add(
      this.makeLine(circlePoints(origin, toWorld(RING_RADIUS[2]), 0.006), { color: COLOR.orbit, width: 1.5, dashed: true }),
    );

    const floorPoint = (id) => {
      const { x, y } = positions.get(id);
      return new THREE.Vector3(toWorld(x - CENTER.x), 0.02, toWorld(y - CENTER.y));
    };
    const distanceOf = new Map(nodes.map((node) => [node.id, node.distance]));

    // Edges to the viewer are solid; edges further out are dashed.
    for (const [from, to] of edges) {
      if (!positions.has(from) || !positions.has(to)) {
        continue;
      }
      const solid = distanceOf.get(from) === 0 || distanceOf.get(to) === 0;
      this.scene.add(
        this.makeLine([floorPoint(from), floorPoint(to)], {
          color: COLOR.edge,
          width: solid ? 3 : 2.2,
          dashed: !solid,
          dash: 0.22,
          gap: 0.16,
        }),
      );
    }

    for (const node of nodes) {
      if (positions.has(node.id)) {
        this.addPerson(node, floorPoint(node.id).setY(0));
      }
    }
    this.applyAppearance();
  }

  addPerson(node, base) {
    const distance = node.distance;
    const radius = AVATAR_RADIUS[distance];
    const frameColor = distance === 0 ? COLOR.primary : distance === 1 ? COLOR.d1 : COLOR.d2;

    // The holder turns to face the camera so the avatar always looks upright.
    const holder = new THREE.Group();
    holder.position.set(base.x, radius + STAND_GAP, base.z);
    this.scene.add(holder);

    const faceGeometry = this.track(new THREE.CircleGeometry(radius, 64));
    const canvases = { normal: createAvatarCanvas(), dimmed: createAvatarCanvas() };
    const textures = {
      normal: this.track(canvasTexture(canvases.normal)),
      dimmed: this.track(canvasTexture(canvases.dimmed)),
    };
    const faceMaterial = this.track(new THREE.MeshBasicMaterial({ map: textures.normal }));
    const face = new THREE.Mesh(faceGeometry, faceMaterial);
    face.castShadow = true;
    face.userData.personId = node.id;
    holder.add(face);
    this.pickTargets.push(face);

    // A solid back so the avatar is not see-through from behind.
    const back = new THREE.Mesh(faceGeometry, this.track(new THREE.MeshStandardMaterial({ color: COLOR.avatarBack })));
    back.rotation.y = Math.PI;
    back.position.z = -0.01;
    back.castShadow = true;
    holder.add(back);

    // Frame: solid for the viewer and friends, broken into dashes for friends of friends.
    const frameMaterial = this.track(new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.5 }));
    const frame = new THREE.Group();
    const inner = radius;
    const outer = radius + FRAME_WIDTH[distance];
    if (distance < 2) {
      frame.add(new THREE.Mesh(this.track(new THREE.RingGeometry(inner, outer, 64)), frameMaterial));
    } else {
      const segments = 14;
      const step = (Math.PI * 2) / segments;
      for (let i = 0; i < segments; i += 1) {
        frame.add(new THREE.Mesh(this.track(new THREE.RingGeometry(inner, outer, 8, 1, i * step, step * 0.62)), frameMaterial));
      }
    }
    frame.position.z = 0.005;
    holder.add(frame);

    // Dashed ring on the floor under the avatar.
    const floorRing = this.makeLine(circlePoints(base, radius * 0.95, 0.03, 64), {
      color: frameColor,
      width: 2.2,
      dashed: true,
      dash: 0.1,
      gap: 0.08,
    });
    this.scene.add(floorRing);

    const labelElement = document.createElement("span");
    labelElement.className = `graph-label graph-label--d${distance}`;
    labelElement.textContent = distance === 0 ? `${node.display_name}（你）` : node.display_name;
    const label = new CSS2DObject(labelElement);
    label.position.set(0, radius + 0.32, 0);
    holder.add(label);

    this.people.set(node.id, {
      distance,
      radius,
      base,
      holder,
      faceMaterial,
      textures,
      frameMaterial,
      frameColor,
      floorRing,
      labelElement,
      lift: 0,
    });
    this.loadAvatar(node.id, canvases, textures);
  }

  // Draws the avatar into both canvases once the image loads (primary, then fallback).
  async loadAvatar(personId, canvases, textures) {
    for (const url of [avatarUrl(personId), FALLBACK_AVATAR_URL]) {
      try {
        const image = await loadImage(url);
        if (this.disposed) {
          return;
        }
        drawAvatar(canvases.normal, image, "none");
        drawAvatar(canvases.dimmed, image, DIMMED_FILTER);
        textures.normal.needsUpdate = true;
        textures.dimmed.needsUpdate = true;
        return;
      } catch {
        // Try the next source; with none left the plain background stays.
      }
    }
  }

  setAppearance(appearance) {
    this.appearance = { ...this.appearance, ...appearance };
    this.applyAppearance();
  }

  applyAppearance() {
    const { matchedIds, filterActive, selectedId, focusedId } = this.appearance;
    for (const [id, person] of this.people) {
      const matched = filterActive && person.distance > 0 && matchedIds.has(id);
      const dimmed = filterActive && person.distance > 0 && !matched;
      person.matched = matched;
      person.dimmed = dimmed;
      person.faceMaterial.map = dimmed ? person.textures.dimmed : person.textures.normal;
      person.faceMaterial.needsUpdate = true;
      const classes = person.labelElement.classList;
      classes.toggle("graph-label--matched", matched);
      classes.toggle("graph-label--dimmed", dimmed);
      classes.toggle("graph-label--selected", id === selectedId);
      classes.toggle("graph-label--focused", id === focusedId);
    }
  }

  // Screen rectangle (viewport coordinates) of a person's avatar, for placing the card.
  anchorRect(personId) {
    const person = this.people.get(personId);
    if (!person) {
      return null;
    }
    const center = new THREE.Vector3(person.base.x, person.radius + STAND_GAP, person.base.z);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(person.radius);
    const box = this.renderer.domElement.getBoundingClientRect();
    const toScreen = (point) => {
      const ndc = point.clone().project(this.camera);
      return { x: box.left + ((ndc.x + 1) / 2) * box.width, y: box.top + ((1 - ndc.y) / 2) * box.height };
    };
    const c = toScreen(center);
    const edge = toScreen(center.clone().add(right));
    const r = Math.hypot(edge.x - c.x, edge.y - c.y);
    return { left: c.x - r, right: c.x + r, top: c.y - r, bottom: c.y + r, width: r * 2, height: r * 2 };
  }

  // Rotates the view around the centre by the given angle in degrees (animated).
  rotateBy(degrees) {
    this.pendingYaw += THREE.MathUtils.degToRad(degrees);
  }

  homePosition() {
    return TARGET.clone().addScaledVector(HOME_DIRECTION, this.cameraDistance);
  }

  resetView() {
    this.pendingYaw = 0;
    // One undamped update consumes any leftover drag inertia before jumping home.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.copy(this.homePosition());
    this.controls.target.copy(TARGET);
    this.controls.update();
    this.controls.enableDamping = damping;
    this.callbacks.onViewChange?.();
  }

  bindPointerEvents() {
    const canvas = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = null;

    const pick = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, this.camera);
      return raycaster.intersectObjects(this.pickTargets, false)[0]?.object.userData.personId ?? null;
    };

    this.onPointerMove = (event) => {
      this.hoveredId = event.pointerType === "mouse" ? pick(event) : null;
      canvas.style.cursor = this.hoveredId ? "pointer" : "grab";
    };
    this.onPointerDown = (event) => {
      downAt = { x: event.clientX, y: event.clientY };
    };
    this.onPointerUp = (event) => {
      // A drag rotates the view; only a press without movement counts as a click.
      if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > CLICK_TOLERANCE_PX) {
        downAt = null;
        return;
      }
      downAt = null;
      const personId = pick(event);
      if (personId) {
        this.callbacks.onSelect?.(personId);
      } else {
        this.callbacks.onBackgroundClick?.();
      }
    };
    this.onPointerLeave = () => {
      this.hoveredId = null;
    };
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
    this.fitCamera(width, height);
    for (const material of this.lineMaterials) {
      material.resolution.set(width, height);
    }
    this.callbacks.onViewChange?.();
  }

  // Picks the closest camera distance at which the floor and the outer ring of people fit
  // inside the margins, then shifts the image vertically (a lens shift, so perspective is
  // unchanged) to centre it. The fitted shapes are circles around the orbit axis, so the
  // framing holds at every rotation angle.
  fitCamera(width, height) {
    const outerRing = toWorld(RING_RADIUS[2]);
    const samples = [];
    for (let i = 0; i < 72; i += 1) {
      const angle = (i / 72) * Math.PI * 2;
      samples.push(new THREE.Vector3(Math.cos(angle) * FLOOR_RADIUS, 0, Math.sin(angle) * FLOOR_RADIUS));
      samples.push(new THREE.Vector3(Math.cos(angle) * outerRing, OUTER_CONTENT_TOP, Math.sin(angle) * outerRing));
    }

    const probe = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 100);
    const limitX = 1 - (FRAME_MARGIN.side * 2) / width;
    const limitY = 2 - ((FRAME_MARGIN.top + FRAME_MARGIN.bottom) * 2) / height;
    let distance = MIN_CAMERA_DISTANCE;
    let bounds;
    for (; distance <= MAX_CAMERA_DISTANCE; distance += 0.1) {
      probe.position.copy(TARGET).addScaledVector(HOME_DIRECTION, distance);
      probe.lookAt(TARGET);
      probe.updateMatrixWorld();
      bounds = projectedBounds(samples, probe);
      if (Math.max(-bounds.minX, bounds.maxX) <= limitX && bounds.maxY - bounds.minY <= limitY) {
        break;
      }
    }
    this.cameraDistance = Math.min(distance, MAX_CAMERA_DISTANCE);

    // Place the content between the top and bottom margins.
    const contentTop = height / 2 - (bounds.maxY * height) / 2;
    const contentBottom = height / 2 - (bounds.minY * height) / 2;
    const shiftY = (contentTop + contentBottom) / 2 - (FRAME_MARGIN.top + height - FRAME_MARGIN.bottom) / 2;
    this.camera.aspect = width / height;
    this.camera.setViewOffset(width, height, 0, shiftY, width, height);
    this.camera.updateProjectionMatrix();

    const offset = this.camera.position.clone().sub(this.controls.target).setLength(this.cameraDistance);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  frame(time) {
    const elapsed = time / 1000;
    this.applyPendingYaw();
    this.controls.update();

    const pulse = this.reducedMotion ? 0.5 : (Math.sin((elapsed / PULSE_SECONDS) * Math.PI * 4) + 1) / 2;
    const glowColor = new THREE.Color(COLOR.primary).lerp(new THREE.Color(COLOR.glow), pulse);
    const { selectedId, focusedId } = this.appearance;

    for (const [id, person] of this.people) {
      const { holder } = person;
      // Face the camera horizontally and lean back halfway toward it: upright, but not squashed.
      const dx = this.camera.position.x - holder.position.x;
      const dz = this.camera.position.z - holder.position.z;
      const elevation = Math.atan2(this.camera.position.y - holder.position.y, Math.hypot(dx, dz));
      holder.rotation.set(-elevation * 0.5, Math.atan2(dx, dz), 0, "YXZ");

      const raised = id === this.hoveredId || id === selectedId || id === focusedId;
      person.lift += ((raised ? LIFT : 0) - person.lift) * (this.reducedMotion ? 1 : 0.15);
      holder.position.y = person.radius + STAND_GAP + person.lift;

      if (person.matched) {
        person.frameMaterial.color.copy(glowColor);
        person.frameMaterial.emissive.copy(glowColor).multiplyScalar(0.35 + pulse * 0.5);
        person.floorRing.material.color.copy(glowColor);
        holder.scale.setScalar(1 + pulse * 0.06);
      } else {
        person.frameMaterial.color.set(person.dimmed ? COLOR.dimmedFrame : person.frameColor);
        person.frameMaterial.emissive.set(0x000000);
        person.floorRing.material.color.set(person.dimmed ? COLOR.dimmedFrame : person.frameColor);
        holder.scale.setScalar(1);
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  applyPendingYaw() {
    if (Math.abs(this.pendingYaw) < 1e-4) {
      this.pendingYaw = 0;
      return;
    }
    const step = this.reducedMotion ? this.pendingYaw : this.pendingYaw * 0.18;
    this.pendingYaw -= step;
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), step);
    this.camera.position.copy(this.controls.target).add(offset);
    this.callbacks.onViewChange?.();
  }

  makeLine(points, { color, width, dashed = false, dash = 0.18, gap = 0.12 }) {
    const geometry = this.track(new LineGeometry());
    geometry.setPositions(points.flatMap((point) => [point.x, point.y, point.z]));
    const material = this.track(new LineMaterial({ color, linewidth: width, dashed, dashSize: dash, gapSize: gap }));
    this.lineMaterials.push(material);
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    return line;
  }

  track(resource) {
    this.disposables.add(resource);
    return resource;
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.controls.dispose();
    for (const resource of this.disposables) {
      resource.dispose();
    }
    this.renderer.dispose();
    canvas.remove();
    this.labelRenderer.domElement.remove();
  }
}

function projectedBounds(points, camera) {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const point of points) {
    const { x, y } = point.clone().project(camera);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  return bounds;
}

function circlePoints(center, radius, y, segments = 96) {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return new THREE.Vector3(center.x + Math.cos(angle) * radius, y, center.z + Math.sin(angle) * radius);
  });
}

const AVATAR_CANVAS_SIZE = 256;

function createAvatarCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_CANVAS_SIZE;
  canvas.height = AVATAR_CANVAS_SIZE;
  drawAvatar(canvas, null, "none");
  return canvas;
}

function drawAvatar(canvas, image, filter) {
  const context = canvas.getContext("2d");
  const size = AVATAR_CANVAS_SIZE;
  context.clearRect(0, 0, size, size);
  context.save();
  context.filter = filter;
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = COLOR.avatarBg;
  context.fillRect(0, 0, size, size);
  if (image) {
    context.drawImage(image, 0, 0, size, size);
  }
  context.restore();
}

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}
