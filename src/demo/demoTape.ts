import { readFileSync } from "node:fs";
import type { Collision } from "../core/collision.ts";
import {
  FLAT_ALIVE,
  FLAT_ANGLE,
  FLAT_TICK,
  FLAT_DIRECTION,
  FLAT_FREEZE_LEFT,
  FLAT_HOOK_STATE,
  FLAT_HOOK_TICK,
  FLAT_HOOK_X,
  FLAT_HOOK_Y,
  FLAT_JUMPED,
  FLAT_POS_X,
  FLAT_POS_Y,
  FLAT_STRIDE,
  FLAT_VEL_X,
  FLAT_VEL_Y,
  FLAT_WEAPON,
} from "../core/world.ts";
import { emptyInput } from "../core/types.ts";
import type { PlayerInput } from "../core/types.ts";
import { parseSnapshot } from "./snapshot.ts";
import type { RawSnapshot } from "./snapshot.ts";

const HOOK_IDLE = 0;

import huffmanLib from "teeworlds/lib/huffman.js";
const Huffman = (huffmanLib as { Huffman: new () => { decompress: (src: Uint8Array) => Uint8Array } }).Huffman;
const HUFF = new Huffman();
function huffmanDecompress(src: Uint8Array): Uint8Array {
  return HUFF.decompress(Buffer.from(src));
}

function varintDecompress(src: Uint8Array): Int32Array {
  const out: number[] = [];
  let s = 0;
  const masks = [0x7f, 0x7f, 0x7f, 0x0f];
  const shifts = [6, 13, 20, 27];
  while (s < src.length) {
    const sign = (src[s] >> 6) & 1;
    let v = src[s] & 0x3f;
    s++;
    for (let i = 0; i < 4; i++) {
      if (!(src[s - 1] & 0x80)) break;
      v |= (src[s] & masks[i]) << shifts[i];
      s++;
    }
    out.push((v ^ -sign) | 0);
  }
  return Int32Array.from(out);
}

function itemFieldsSize(type: number, data: Int32Array, p: number): number {
  const staticSizes: Record<number, number> = { 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 8, 7: 4, 8: 15, 9: 22, 10: 5, 11: 17, 12: 3, 13: 2, 14: 2, 15: 2, 16: 2, 17: 3, 18: 3, 19: 3, 20: 3 };
  if (staticSizes[type] !== undefined) return staticSizes[type];
  return data[p];
}

function unpackDelta(prev: RawSnapshot, delta: Int32Array): RawSnapshot {
  const numDeleted = delta[0] ?? 0;
  const numUpdate = delta[1] ?? 0;
  let p = 3;
  const deleted = new Set<number>();
  for (let i = 0; i < numDeleted; i++) deleted.add(delta[p++] ?? 0);
  const items: { key: number; type: number; id: number; fields: number[] }[] = [];
  for (const it of prev.items) {
    if (deleted.has(it.key)) continue;
    items.push({ key: it.key, type: it.type, id: it.id, fields: Array.from(it.fields) });
  }
  for (let i = 0; i < numUpdate; i++) {
    const type = delta[p++] ?? 0;
    const id = delta[p++] ?? 0;
    const hasSize = type >= 64;
    const size = hasSize ? (delta[p++] ?? 0) : itemFieldsSize(type, delta, p);
    const key = (type << 16) | id;
    const fields: number[] = [];
    const old = prev.byKey.get(key);
    const base = old === undefined ? undefined : prev.items[old]?.fields;
    for (let f = 0; f < size; f++) {
      const diff = delta[p++] ?? 0;
      fields.push(((base?.[f] ?? 0) + diff) | 0);
    }
    const idx = items.findIndex((x) => x.key === key);
    if (idx >= 0) items[idx] = { key, type, id, fields };
    else items.push({ key, type, id, fields });
  }
  const byKey = new Map<number, number>();
  items.forEach((it, i) => byKey.set(it.key, i));
  return { items: items.map((it) => ({ ...it, fields: Int32Array.from(it.fields) })), byKey };
}

export type DemoFrame = { tick: number; snap: RawSnapshot };

export function readDemoFrames(path: string): DemoFrame[] {
  const b = readFileSync(path);
  if (b.subarray(0, 7).toString("latin1") !== "TWDEMO\0") throw new Error("demo: bad marker");
  const version = b[7];
  const mapSize = b.readUInt32BE(136);
  let p = 484 + mapSize;
  let tick = -1;
  let last: RawSnapshot | null = null;
  const frames: DemoFrame[] = [];
  while (p + 1 < b.length) {
    const c = b[p++];
    if (c & 0x80) {
      if (version >= 5 && (c & 0x20)) tick += c & 0x1f;
      else tick = b.readUInt32BE(p), (p += 4);
      continue;
    }
    const type = (c & 0x60) >> 5;
    let size = c & 0x1f;
    if (size === 30) size = b[p++];
    else if (size === 31) {
      size = b[p] | (b[p + 1] << 8);
      p += 2;
    }
    if (p + size > b.length) throw new Error("demo: chunk past end");
    const data = varintDecompress(huffmanDecompress(b.subarray(p, p + size)));
    p += size;
    if (type === 1) last = parseSnapshot(data);
    else if (type === 3 && last !== null) last = unpackDelta(last, data);
    if (last !== null && tick >= 0) frames.push({ tick, snap: last });
  }
  return frames;
}

type CharFields = { id: number; x: number; y: number; vx: number; vy: number; angle: number; dir: number; jumped: number; hookState: number; hookX: number; hookY: number; weapon: number };

function character(f: DemoFrame, id: number): CharFields | null {
  const it = f.snap.items.find((x) => x.type === 9 && x.id === id);
  if (it === undefined || it.fields.length < 22) return null;
  const v = it.fields;
  return {
    id,
    x: v[1], y: v[2], vx: v[3], vy: v[4], angle: v[5], dir: v[6], jumped: v[7],
    hookState: v[9], hookX: v[11], hookY: v[12], weapon: v[19],
  };
}

export type DemoTape = { inputs: PlayerInput[]; states: Float64Array; startTick: number; endTick: number; player: number; path: { tx: number; ty: number }[] };

/** Build a replayable input/state tape from a recorded DDNet 0.6 demo. */
export function demoTapeFrom(path: string, _col: Collision): DemoTape {
  void _col;
  const frames = readDemoFrames(path);
  if (frames.length === 0) throw new Error("demo: no snapshots");
  const ids = new Set<number>();
  for (const f of frames) for (const it of f.snap.items) if (it.type === 9) ids.add(it.id);
  let player = -1;
  let best = -1;
  for (const id of ids) {
    let far = -1;
    for (const f of frames) {
      const c = character(f, id);
      if (c !== null) far = Math.max(far, c.x);
    }
    if (far > best) best = far, player = id;
  }
  if (player < 0) throw new Error("demo: no player character");
  // People record a few failed attempts before the good one. Start at the
  // last spawn so the tape is a single clean start→finish run.
  let startFrame = 0;
  for (let i = 0; i < frames.length; i++) {
    const c = character(frames[i], player);
    if (c !== null && c.x < 1000 && c.y > 5000) startFrame = i;
  }
  const first = frames[startFrame].tick;
  const last = frames[frames.length - 1].tick;
  const byTick = new Map<number, CharFields>();
  for (const f of frames) {
    const c = character(f, player);
    if (c !== null) byTick.set(f.tick, c);
  }
  const frameList = frames.slice(startFrame);
  const inputs: PlayerInput[] = [];
  const states: number[] = [];
  let prevJump = 0;
  let fi = 0;
  for (let t = first; t <= last; t++) {
    while (fi + 1 < frameList.length - 1 && frameList[fi + 1].tick <= t) fi++;
    const a = character(frameList[fi], player) ?? byTick.get(t);
    const b = character(frameList[Math.min(fi + 1, frameList.length - 1)], player) ?? a;
    if (a === null || b === null) continue;
    const gap = frameList[Math.min(fi + 1, frameList.length - 1)].tick - frameList[fi].tick;
    const u = gap > 0 ? Math.max(0, Math.min(1, (t - frameList[fi].tick) / gap)) : 0;
    const lerp = (x: number, y: number): number => x + (y - x) * u;
    const c: CharFields = {
      id: player,
      x: lerp(a.x, b.x), y: lerp(a.y, b.y), vx: lerp(a.vx, b.vx), vy: lerp(a.vy, b.vy),
      angle: lerp(a.angle, b.angle), dir: u < 0.5 ? a.dir : b.dir,
      jumped: u < 0.5 ? a.jumped : b.jumped, hookState: u < 0.5 ? a.hookState : b.hookState,
      hookX: lerp(a.hookX, b.hookX), hookY: lerp(a.hookY, b.hookY), weapon: a.weapon,
    };
    const inp = emptyInput();
    inp.direction = c.dir < 0 ? -1 : c.dir > 0 ? 1 : 0;
    inp.jump = c.jumped !== prevJump ? 1 : 0;
    inp.hook = c.hookState !== HOOK_IDLE ? 1 : 0;
    inp.targetX = c.hookX;
    inp.targetY = c.hookY;
    inp.wantedWeapon = c.weapon;
    prevJump = c.jumped;
    inputs.push(inp);
    const st = new Array<number>(FLAT_STRIDE).fill(0);
    st[FLAT_TICK] = t;
    st[FLAT_POS_X] = c.x;
    st[FLAT_POS_Y] = c.y;
    st[FLAT_VEL_X] = c.vx / 256;
    st[FLAT_VEL_Y] = c.vy / 256;
    st[FLAT_ANGLE] = c.angle;
    st[FLAT_DIRECTION] = c.dir;
    st[FLAT_JUMPED] = c.jumped;
    st[FLAT_HOOK_STATE] = c.hookState;
    st[FLAT_HOOK_X] = c.hookX;
    st[FLAT_HOOK_Y] = c.hookY;
    st[FLAT_HOOK_TICK] = 0;
    st[FLAT_FREEZE_LEFT] = 0;
    st[FLAT_ALIVE] = 1;
    st[FLAT_WEAPON] = c.weapon;
    states.push(...st);
  }
  if (inputs.length > 1 && inputs.length % 2 !== 0) {
    inputs.pop();
    states.length -= FLAT_STRIDE;
  }
  // One more state than inputs: the state after the last input.
  states.push(...states.slice(states.length - FLAT_STRIDE, states.length));
  const waypoints: { tx: number; ty: number }[] = [];
  const arr = Float64Array.from(states);
  for (let i = 0; i <= inputs.length; i++) {
    const o = i * FLAT_STRIDE;
    const tile = { tx: Math.floor(arr[o + FLAT_POS_X] / 32), ty: Math.floor(arr[o + FLAT_POS_Y] / 32) };
    if (waypoints.length === 0 || waypoints[waypoints.length - 1].tx !== tile.tx || waypoints[waypoints.length - 1].ty !== tile.ty) waypoints.push(tile);
  }
  return { inputs, states: arr, startTick: first, endTick: first + inputs.length, player, path: waypoints };
}

