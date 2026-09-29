import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { diceById } from '../data';
import type { RolledDie } from '../game/types';
import { beginDiceSweep, moveDiceSweep, type DiceSweep } from './diceSweep';
import './DiceTray.css';

export interface PendingDiceRoll { id: string; playerId: string; diceIds: string[]; afterEventId: number }
interface Props {
  dice: RolledDie[]; selected?: string[]; onSelect?: (id: string) => void; disabled?: boolean; compact?: boolean;
  reducedMotion?: boolean; lowQuality?: boolean; onDropDie?: (ownId: string, poolId: string) => void; pool?: boolean;
  rollEventKey?: number | string; rollingIds?: string[]; onRollingChange?: (rolling: boolean) => void;
  draggableDice?: boolean; onSelectionChange?: (ids: string[]) => void;
  animateNewDice?: boolean;
  selectionSurface?: RefObject<HTMLElement | null>;
  pendingRoll?: PendingDiceRoll;
}
const effects: Record<string, string> = { venom: '猛毒', poison: '中毒', double: '翻倍', fated: '命定', heal: '治愈', combo: '连击', reflect: '反伤', counter: '反击', forcefield: '力场', unyielding: '不屈', overload: '超载', lastStand: '背水', hack: '骇入', thorns: '荆棘', instant: '瞬伤', lucky: '强运', toughness: '韧性', strength: '力量', siphon: '虹吸', refund: '曜彩恢复' };
const stride = 1.3;
export const DICE_ROLL_MAX_MS = 1150;
interface Face { normal: THREE.Vector3; center: THREE.Vector3; vertices: THREE.Vector3[]; radius: number }
interface RollMotion {
  start: number; duration: number; from: THREE.Quaternion; axis: THREE.Vector3; crossAxis: THREE.Vector3;
  turns: number; crossTurns: number; height: number; drift: number; depth: number; phase: number;
}
interface DieVisual {
  die: RolledDie; group: THREE.Group; outline: THREE.Mesh; body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  labels: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[]; shadow: THREE.Mesh; rest: THREE.Quaternion; edges?: THREE.LineSegments;
  targetX: number; targetY: number; lift: number; targetLift: number; signature: string;
  motion?: RollMotion;
  pendingKey?: string;
}
const shape = (d: RolledDie) => d.sides <= 4 ? 4 : d.sides <= 6 ? 6 : d.sides <= 8 ? 8 : 12;
const color = (d: RolledDie) => d.prismatic ? 0x5367df : d.sides <= 4 ? 0x22bfe4 : d.sides <= 6 ? 0x9e36ed : d.sides <= 8 ? 0xf4af5d : 0x5367df;
const signature = (d: RolledDie) => `${d.sides}/${d.prismatic}/${d.typeId || ''}/${d.value}/${d.effect || ''}`;
function hash(id: string) {
  let n = 0; for (const c of id) n = (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0;
  n = Math.imul(n ^ n >>> 16, 0x7feb352d); n = Math.imul(n ^ n >>> 15, 0x846ca68b); return (n ^ n >>> 16) >>> 0;
}

/** Recover flat faces before chamfering: printed numbers lie on real solid faces. */
function faceGeometry(sides: number): { geometry: THREE.BufferGeometry; faces: Face[] } {
  const source = sides === 4 ? new THREE.TetrahedronGeometry(.76) : sides === 6 ? new THREE.BoxGeometry(.91, .91, .91) : sides === 8 ? new THREE.OctahedronGeometry(.76) : new THREE.DodecahedronGeometry(.69);
  const raw = source.index ? source.toNonIndexed() : source, positions = raw.getAttribute('position');
  const grouped = new Map<string, { normal: THREE.Vector3; points: Map<string, THREE.Vector3> }>();
  for (let i = 0; i < positions.count; i += 3) {
    const vertices = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(positions, i + k));
    const normal = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize();
    const key = normal.toArray().map(n => Math.round(n * 1000) || 0).join('/');
    let face = grouped.get(key); if (!face) { face = { normal, points: new Map() }; grouped.set(key, face); }
    for (const v of vertices) face.points.set(v.toArray().map(n => Math.round(n * 10000) || 0).join('/'), v);
  }
  const faces: Face[] = [...grouped.values()].map(f => {
    const vertices = [...f.points.values()], center = vertices.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(vertices.length);
    const u = vertices[0].clone().sub(center).normalize(), v = f.normal.clone().cross(u);
    vertices.sort((a, b) => Math.atan2(a.clone().sub(center).dot(v), a.clone().sub(center).dot(u)) - Math.atan2(b.clone().sub(center).dot(v), b.clone().sub(center).dot(u)));
    const radius = Math.min(...vertices.map((p, i) => new THREE.Line3(p, vertices[(i + 1) % vertices.length]).closestPointToPoint(center, true, new THREE.Vector3()).distanceTo(center)));
    return { normal: f.normal, vertices, center, radius };
  });
  // Canonical front facets: tiny float differences must not pick an upside-down face.
  faces.sort((a, b) => Math.round(b.normal.z * 1000) - Math.round(a.normal.z * 1000) || (sides === 4 ? a.normal.y - b.normal.y : b.normal.y - a.normal.y));
  const geometry = sides === 6 ? new RoundedBoxGeometry(.91, .91, .91, 3, .065) : new ConvexGeometry(faces.flatMap(f => f.vertices.map(v => v.clone().lerp(f.center, .095))));
  if (raw !== source) raw.dispose(); source.dispose(); return { geometry, faces };
}

class DiceRenderer {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-3, 3, 2, -2, .1, 30);
  items = new Map<string, DieVisual>(); textures = new Map<string, THREE.CanvasTexture>(); observer: ResizeObserver;
  spin = new THREE.Quaternion(); crossSpin = new THREE.Quaternion();
  frame = 0; reduced = false; quality = false; count = 1; lastKey?: number | string; initialized = false; disposed = false; rollingKey = '';
  constructor(readonly element: HTMLDivElement, readonly onRolling: (ids: string[]) => void) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6)); this.element.appendChild(this.renderer.domElement); this.camera.position.set(0, 0, 12);
    this.scene.add(new THREE.HemisphereLight(0xf9f6ff, 0x67769e, 2.25));
    const key = new THREE.DirectionalLight(0xfff5e5, 3.2); key.position.set(-3, 5, 8); this.scene.add(key);
    const edge = new THREE.DirectionalLight(0xa1b6ff, 1.7); edge.position.set(4, 1, -2); this.scene.add(edge);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(element); this.resize();
  }
  texture(text: string, effect = '') {
    const key = `${text}/${effect}`, cached = this.textures.get(key); if (cached) return cached;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const ctx = canvas.getContext('2d')!;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `900 ${text.length > 1 ? 132 : 178}px "Arial Black", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = '#fffaf0'; ctx.shadowColor = '#ffffff55'; ctx.shadowBlur = 3; ctx.fillText(text, 128, 137); ctx.shadowBlur = 0;
    if (text === '6' || text === '9') { ctx.beginPath(); ctx.arc(128, 224, 7, 0, Math.PI * 2); ctx.fill(); }
    if (effect && text !== '✦') { ctx.font = 'bold 35px sans-serif'; ctx.fillText(effect === 'heal' ? '+' : '✧', 211, 42); }
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy()); this.textures.set(key, map); return map;
  }
  shadowTexture() {
    const cached = this.textures.get('shadow'); if (cached) return cached;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!, gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#28385380'); gradient.addColorStop(.5, '#28385338'); gradient.addColorStop(1, '#28385300'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas); this.textures.set('shadow', texture); return texture;
  }
  create(die: RolledDie) {
    const { geometry, faces } = faceGeometry(shape(die)), group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: color(die), roughness: .36, metalness: die.prismatic ? .3 : .12, emissive: color(die), emissiveIntensity: .035 });
    const body = new THREE.Mesh(geometry, material); group.add(body);
    let edges: THREE.LineSegments | undefined;
    if (shape(die) === 8) { edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), new THREE.LineBasicMaterial({ color: 0x98633b, transparent: true, opacity: .2 })); group.add(edges); group.scale.y = 1.08; }
    const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x287eff, side: THREE.BackSide })); outline.scale.setScalar(1.105); outline.visible = false; group.add(outline);
    const align = new THREE.Quaternion().setFromUnitVectors(faces[0].normal, new THREE.Vector3(0, 0, 1));
    const frontUp = new THREE.Vector3(0, 1, 0).projectOnPlane(faces[0].normal).normalize().applyQuaternion(align);
    const straight = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(frontUp.x, frontUp.y));
    const rest = new THREE.Quaternion().setFromEuler(shape(die) === 8 ? new THREE.Euler(.065, -.055, 0) : new THREE.Euler(.15, -.13, -.015)).multiply(straight).multiply(align);
    const labels = faces.map((f, i) => {
      let up = new THREE.Vector3(0, 1, 0).projectOnPlane(f.normal); if (up.lengthSq() < .01) up = new THREE.Vector3(0, 0, 1).projectOnPlane(f.normal); up.normalize();
      const right = up.clone().cross(f.normal).normalize();
      const sideInk = shape(die) === 8 && i > 0, labelSize = f.radius * (shape(die) === 8 ? sideInk ? 1.65 : 2.4 : 2.03);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(labelSize, labelSize), new THREE.MeshBasicMaterial({ color: sideInk ? 0x78512e : 0xffffff, opacity: sideInk ? .7 : 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
      label.position.copy(f.center).addScaledVector(f.normal, .002); label.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, f.normal)); group.add(label); return label;
    });
    group.quaternion.copy(rest); this.scene.add(group);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.24, .48), new THREE.MeshBasicMaterial({ map: this.shadowTexture(), transparent: true, depthWrite: false })); shadow.position.set(0, -.51, -.85); this.scene.add(shadow);
    const item: DieVisual = { die, body, group, outline, labels, rest, shadow, edges, targetX: 0, targetY: 0, lift: 0, targetLift: 0, signature: signature(die) }; this.print(item, false); return item;
  }
  print(item: DieVisual, concealed: boolean) {
    const values = item.die.typeId ? diceById[item.die.typeId]?.faces.map(f => f.value) : undefined;
    item.labels.forEach((label, i) => { const value = !concealed && i === 0 ? item.die.value : values?.[i % values.length] ?? (i % item.die.sides) + 1; label.material.map = this.texture(String(value), !concealed && i === 0 ? item.die.effect : ''); label.material.needsUpdate = true; });
  }
  remove(item: DieVisual) {
    this.scene.remove(item.group, item.shadow); item.body.geometry.dispose(); item.body.material.dispose(); (item.outline.material as THREE.Material).dispose();
    item.edges?.geometry.dispose(); if (item.edges) (item.edges.material as THREE.Material).dispose();
    item.labels.forEach(l => { l.geometry.dispose(); l.material.dispose(); }); item.shadow.geometry.dispose(); (item.shadow.material as THREE.Material).dispose();
  }
  update(dice: RolledDie[], selected: string[], reduced: boolean, low: boolean, eventKey?: string | number, rollingIds: string[] = [], animateNew = true, pending?: PendingDiceRoll) {
    this.reduced = reduced;
    if (low !== this.quality) { this.quality = low; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.6)); }
    const eventChanged = this.initialized && eventKey !== undefined && eventKey !== this.lastKey; this.initialized = true; this.lastKey = eventKey;
    const ids = new Set(dice.map(d => d.id)); for (const [id, item] of this.items) if (!ids.has(id)) { this.remove(item); this.items.delete(id); }
    let animated = 0;
    for (const [i, die] of dice.entries()) {
      let item = this.items.get(die.id);
      if (item && (shape(item.die) !== shape(die) || item.die.prismatic !== die.prismatic)) { this.remove(item); this.items.delete(die.id); item = undefined; }
      const added = !item;
      if (!item) { item = this.create(die); this.items.set(die.id, item); }
      const changed = item.signature !== signature(die); item.die = die; item.signature = signature(die);
      const awaiting = pending?.diceIds.includes(die.id) ? pending.id : undefined;
      const pendingStarted = awaiting !== undefined && awaiting !== item.pendingKey;
      const pendingEnded = item.pendingKey !== undefined && awaiting === undefined;
      item.pendingKey = awaiting;
      item.targetX = (i - (dice.length - 1) / 2) * stride; if (added) item.group.position.x = item.targetX; item.shadow.position.x = item.targetX;
      item.targetLift = selected.includes(die.id) ? .075 : 0; item.outline.visible = selected.includes(die.id); item.body.material.emissiveIntensity = selected.includes(die.id) ? .11 : .035;
      if (reduced || !animateNew) {
        item.motion = undefined; item.lift = item.targetLift;
        item.group.position.set(item.targetX, item.targetY + item.lift, 0); item.group.quaternion.copy(item.rest);
        this.print(item, false);
        if (awaiting) for (const label of item.labels) { label.material.map = this.texture('✦'); label.material.needsUpdate = true; }
      }
      else if (added || pendingStarted || pendingEnded || eventChanged && rollingIds.includes(die.id)) {
        // Presentation-only variation: never consume the game RNG or use the rolled result.
        const seed = `${die.id}/${awaiting || eventKey || 'initial'}`;
        const sample = (part: string) => hash(`${part}/${seed}`) / 0xffffffff;
        const direction = sample('direction') < .5 ? -1 : 1;
        item.motion = {
          start: performance.now() + Math.min(animated++ * 22, 110), duration: pendingEnded ? 540 : 920 + sample('duration') * 100,
          from: item.group.quaternion.clone(), axis: new THREE.Vector3(.65 + sample('axis-x'), direction * (.35 + sample('axis-y')), sample('axis-z') - .5).normalize(),
          crossAxis: new THREE.Vector3(sample('cross-x') - .5, .45 + sample('cross-y'), direction * .75).normalize(),
          turns: direction * (1.25 + sample('turns') * .55), crossTurns: .55 + sample('cross-turns') * .45,
          height: .36 + sample('height') * .17, drift: direction * (.09 + sample('drift') * .08), depth: .1 + sample('depth') * .15,
          phase: sample('phase') * Math.PI * 2,
        };
        this.print(item, true);
      } else if (changed && !item.motion) this.print(item, false);
    }
    this.count = Math.max(1, dice.length); this.publishRolling(); this.resize(false); this.wake();
  }
  publishRolling() { const ids = [...this.items.values()].filter(i => i.motion).map(i => i.die.id), key = ids.join('|'); if (key !== this.rollingKey) { this.rollingKey = key; this.onRolling(ids); } }
  resize(snap = true) {
    if (this.disposed) return;
    const width = Math.max(1, this.element.clientWidth), height = Math.max(1, this.element.clientHeight);
    // A padded canvas leaves room for tumbling at the row's edges without shrinking the resting dice.
    const controls = this.element.parentElement?.querySelector<HTMLElement>('.dice-controls');
    const controlsWidth = Math.max(1, controls?.clientWidth ?? width);
    const buttons = Array.from(controls?.querySelectorAll<HTMLButtonElement>('[data-die-id]') || []);
    const grid = controls && getComputedStyle(controls).display === 'grid';
    // CSS owns the responsive grid. The solids, outlines, shadows and hit targets share
    // the same measured centers, so a portrait row wrap never changes the game state.
    const columns = grid && buttons.length ? buttons.filter(button => button.offsetTop === buttons[0].offsetTop).length : this.count;
    const span = Math.max(1, columns) * stride * width / controlsWidth;
    const bounds = this.element.getBoundingClientRect();
    buttons.forEach(button => {
      const item = this.items.get(button.dataset.dieId || '');
      if (!item) return;
      const rect = button.getBoundingClientRect();
      const unitsPerPixel = span / Math.max(1, bounds.width);
      item.targetX = (rect.left + rect.width / 2 - bounds.left - bounds.width / 2) * unitsPerPixel;
      item.targetY = (bounds.top + bounds.height / 2 - rect.top - rect.height / 2) * unitsPerPixel;
      // A viewport reflow is immediate. Adding/removing dice keeps the existing
      // horizontal slide, while selection and rolling retain their own animation.
      if (snap) item.group.position.x = item.targetX;
    });
    this.renderer.setSize(width, height, false); this.camera.left = -span / 2; this.camera.right = span / 2; this.camera.top = span * height / width / 2; this.camera.bottom = -this.camera.top; this.camera.updateProjectionMatrix(); this.wake();
  }
  wake() { if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(now => this.render(now)); }
  render(now: number) {
    this.frame = 0; if (this.disposed) return; let active = false;
    for (const item of this.items.values()) {
      const delta = item.targetLift - item.lift, dx = item.targetX - item.group.position.x;
      if (Math.abs(delta) > .001 && !this.reduced) { item.lift += delta * .25; active = true; } else item.lift = item.targetLift;
      if (Math.abs(dx) > .002 && !item.motion && !this.reduced) { item.group.position.x += dx * .28; active = true; } else item.group.position.x = item.targetX;
      item.group.position.y = item.targetY + item.lift; item.group.position.z = 0;
      if (item.motion && item.pendingKey) {
        // Wait for authority with motion only: no local result, RNG or extra roll.
        const motion = item.motion, elapsed = Math.max(0, now - motion.start) / 720;
        active = true;
        item.group.position.y += Math.abs(Math.sin(elapsed * Math.PI)) * motion.height;
        item.group.position.x += Math.sin(elapsed * Math.PI * 2) * motion.drift;
        this.spin.setFromAxisAngle(motion.axis, elapsed * Math.PI * 2);
        this.crossSpin.setFromAxisAngle(motion.crossAxis, elapsed * Math.PI * 1.2);
        item.group.quaternion.copy(this.spin).multiply(this.crossSpin).multiply(motion.from);
      } else if (item.motion) {
        const motion = item.motion, progress = Math.max(0, Math.min(1, (now - motion.start) / motion.duration));
        if (progress >= 1) { item.motion = undefined; item.group.quaternion.copy(item.rest); this.print(item, false); }
        else {
          active = true;
          const bounce = progress < .52 ? progress / .52 : progress < .79 ? (progress - .52) / .27 : (progress - .79) / .21;
          const amplitude = motion.height * (progress < .52 ? 1 : progress < .79 ? .37 : .1);
          const height = 4 * bounce * (1 - bounce) * amplitude;
          const travel = Math.sin(progress * Math.PI);
          item.group.position.y += height;
          item.group.position.x += travel * (motion.drift + Math.sin(progress * Math.PI * 3 + motion.phase) * .035);
          item.group.position.z = travel * Math.sin(progress * Math.PI * 2 + motion.phase) * motion.depth;
          // Compound axes create real tumbling; the final small hop eases back onto the numbered face.
          const tumble = Math.min(progress, .8), angular = 1 - (1 - tumble) ** 1.6;
          this.spin.setFromAxisAngle(motion.axis, angular * Math.PI * 2 * motion.turns);
          this.crossSpin.setFromAxisAngle(motion.crossAxis, (angular + Math.sin(tumble * Math.PI * 3) * .035) * Math.PI * 2 * motion.crossTurns);
          item.group.quaternion.copy(this.spin).multiply(this.crossSpin).multiply(motion.from);
          const settle = Math.max(0, (progress - .8) / .2);
          if (settle) item.group.quaternion.slerp(item.rest, settle * settle * (3 - 2 * settle));
        }
      }
      const height = Math.max(0, item.group.position.y - item.targetY - item.lift);
      item.shadow.position.set(item.group.position.x - item.group.position.z * .15, item.targetY - .51 - item.group.position.z * .1, -.85);
      item.shadow.scale.set(1 + height * .48, 1 + height * .22, 1);
      (item.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - Math.min(.55, height * .85);
    }
    this.publishRolling(); this.renderer.render(this.scene, this.camera); if (active) this.wake();
  }
  dispose() { this.disposed = true; cancelAnimationFrame(this.frame); this.observer.disconnect(); for (const item of this.items.values()) this.remove(item); this.items.clear(); for (const texture of this.textures.values()) texture.dispose(); this.textures.clear(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}

export default function DiceTray({ dice, selected = [], onSelect, disabled, compact, reducedMotion, lowQuality, onDropDie, pool, rollEventKey, rollingIds = [], onRollingChange, draggableDice = false, onSelectionChange, animateNewDice = true, selectionSurface, pendingRoll }: Props) {
  const mount = useRef<HTMLDivElement>(null), renderer = useRef<DiceRenderer | null>(null), callback = useRef(onRollingChange); callback.current = onRollingChange;
  const [fallback, setFallback] = useState(false), [moving, setMoving] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[] | null>(null);
  const suppressClickUntil = useRef(0), selectionOptions = useRef({ selected, onSelectionChange });
  selectionOptions.current = { selected, onSelectionChange };
  const sweepEnabled = !disabled && !draggableDice && !!onSelectionChange && !moving.length;
  const selection = draft || selected;
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const reduced = !!reducedMotion || systemReduced;
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'), change = () => setSystemReduced(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => {
    if (!mount.current) return;
    try { renderer.current = new DiceRenderer(mount.current, ids => { setMoving(ids); callback.current?.(ids.length > 0); }); setFallback(false); }
    catch { setFallback(true); callback.current?.(false); }
    return () => { renderer.current?.dispose(); renderer.current = null; callback.current?.(false); };
  }, []);
  useEffect(() => { renderer.current?.update(dice, selection, reduced, !!lowQuality, rollEventKey, rollingIds, animateNewDice, pendingRoll); }, [dice, selection, reduced, lowQuality, rollEventKey, rollingIds, animateNewDice, pendingRoll]);
  useEffect(() => {
    const tray = mount.current?.parentElement, surface = selectionSurface?.current || tray;
    if (!sweepEnabled || !tray || !surface) return;
    let gesture: (DiceSweep & { pointer: number }) | null = null;
    const ownDie = (target: Element | null) => {
      const hit = target?.closest<HTMLButtonElement>('[data-die-id]');
      return hit && !hit.disabled && tray.contains(hit) ? hit.dataset.dieId : undefined;
    };
    const sweepTo = (x: number, y: number) => {
      if (gesture && moveDiceSweep(gesture, x, y, (px, py) => ownDie(document.elementFromPoint(px, py)))) {
        setDraft([...gesture.ids]); selectionOptions.current.onSelectionChange?.([...gesture.ids]);
      }
    };
    const finish = (commit: boolean) => {
      const current = gesture;
      if (!current) return;
      gesture = null;
      setDraft(null);
      suppressClickUntil.current = performance.now() + 500;
      if (surface.hasPointerCapture(current.pointer)) surface.releasePointerCapture(current.pointer);
      if (commit && current.visited.size) selectionOptions.current.onSelectionChange?.([...current.ids]);
    };
    const start = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || gesture || !(event.target instanceof Element)) return;
      const initialId = ownDie(event.target);
      // Blank table space may start a sweep; controls and the other trays may not.
      if (!initialId && event.target.closest('button, a, input, textarea, select, [role="button"], [role="dialog"], [contenteditable="true"], .player-hud, .swap-zone, .weather-popover, .tactic-hand, [data-sweep-ignore]')) return;
      suppressClickUntil.current = 0;
      gesture = { ...beginDiceSweep(selectionOptions.current.selected, event.clientX, event.clientY, initialId), pointer: event.pointerId };
      surface.setPointerCapture(event.pointerId);
      if (initialId) { setDraft([...gesture.ids]); selectionOptions.current.onSelectionChange?.([...gesture.ids]); }
    };
    const move = (event: PointerEvent) => {
      if (gesture?.pointer !== event.pointerId) return;
      event.preventDefault();
      sweepTo(event.clientX, event.clientY);
    };
    const end = (event: PointerEvent) => { if (gesture?.pointer === event.pointerId) { sweepTo(event.clientX, event.clientY); finish(true); } };
    const cancel = (event: PointerEvent) => { if (gesture?.pointer === event.pointerId) finish(false); };
    const contextMenu = (event: MouseEvent) => { if (gesture) event.preventDefault(); };
    surface.classList.add('dice-sweep-surface');
    surface.addEventListener('pointerdown', start);
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', cancel);
    surface.addEventListener('lostpointercapture', cancel);
    surface.addEventListener('contextmenu', contextMenu);
    return () => {
      surface.removeEventListener('pointerdown', start);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', end);
      surface.removeEventListener('pointercancel', cancel);
      surface.removeEventListener('lostpointercapture', cancel);
      surface.removeEventListener('contextmenu', contextMenu);
      surface.classList.remove('dice-sweep-surface');
      finish(false);
    };
  }, [sweepEnabled, selectionSurface]);
  return <div className={`dice-tray sculpted-dice ${compact ? 'compact' : ''} ${pool ? 'pool' : ''} ${fallback ? 'dice-fallback' : ''} ${draft ? 'sweeping' : ''}`} style={{ '--dice-count': Math.max(1, dice.length) } as CSSProperties}>
    <div className="dice-canvas" ref={mount} aria-hidden="true"/>
    <div className="dice-controls">{dice.map(die => {
      const rolling = moving.includes(die.id) || !!pendingRoll?.diceIds.includes(die.id), picked = selection.includes(die.id), effect = die.effect ? effects[die.effect] : undefined;
      const name = `${die.prismatic ? '曜彩骰' : `${die.sides}面骰`} ${rolling ? '投掷中' : `${die.value}点${effect ? ` · ${effect}` : ''}`}`;
      return <button key={die.id} className={`die-control ${picked ? 'selected' : ''} ${rolling ? 'rolling' : ''} ${die.prismatic ? 'prismatic' : ''} d${die.sides}`} disabled={!!disabled && !(pool && onDropDie) || rolling}
        data-die-id={die.id} aria-label={name} title={name} aria-pressed={picked} aria-busy={rolling} onClick={e => { if (e.detail > 0 && performance.now() < suppressClickUntil.current) return; if (!disabled) onSelect?.(die.id); }} draggable={draggableDice && !disabled && !pool && !rolling}
        onContextMenu={e => { if (onSelectionChange && !draggableDice) e.preventDefault(); }}
        onDragStart={e => { if (!draggableDice || disabled || pool || rolling) { e.preventDefault(); return; } e.dataTransfer.setData('application/starrail-die', die.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={e => { if (pool && onDropDie) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
        onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('application/starrail-die'); if (id && pool) onDropDie?.(id, die.id); }}>
        <span className="die-value" aria-hidden="true">{rolling ? '·' : die.value}</span>
        {fallback && <span className="die-fallback-solid" aria-hidden="true">{rolling ? '·' : die.value}</span>}
        {effect && <span className="die-effect" aria-hidden="true" title={effect}>{die.forced ? '◆' : '✦'}</span>}
        <span className="die-label">{effect || (die.prismatic ? '曜彩骰' : `${die.sides}面骰`)}</span>
      </button>;
    })}</div>
    {!dice.length && <span className="empty-dice">等待投掷</span>}
  </div>;
}
