import assert from "node:assert/strict";
import test from "node:test";

import { Collision } from "../src/core/collision.ts";
import { blankTeeState } from "../src/core/types.ts";
import { TILE_FREEZE, TILE_SOLID, TILE_TELEIN } from "../src/core/tuning.ts";
import { RaceClock, RaceDriver, fieldWaypoint, isRaceMap, raceHit, raceLines, raceMapAnalysis, raceMapLikely, waypoint } from "../src/plan/race.ts";

const TILE = 32;
const at = (tx, ty) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

function makeMap({ width = 8, height = 8, game = [], front = [] } = {}) {
  const tiles = new Uint8Array(width * height);
  for (const [x, y, t] of game) tiles[y * width + x] = t;
  const extras = front.length > 0
    ? { front: { index: Uint8Array.from(front.map(([, , t]) => t)), flags: new Uint8Array(width * height) } }
    : undefined;
  if (extras) {
    // The front array in the test is a sparse [x, y, tile] list.
    const index = new Uint8Array(width * height);
    for (const [x, y, t] of front) index[y * width + x] = t;
    extras.front.index = index;
  }
  return new Collision(width, height, tiles, undefined, undefined, extras);
}

function tee(pos, extra = {}) {
  return { ...blankTeeState(), alive: true, pos, ...extra };
}

function driver(col, opts = {}) {
  return new RaceDriver(col, { pumpMs: Infinity, pumpYields: Infinity, killCooldownTicks: 1, ...opts });
}

test("start and finish tiles are found in both the game and the front layer", () => {
  const col = makeMap({ game: [[1, 1, 33]], front: [[3, 4, 34], [3, 5, 34]] });
  const lines = raceLines(col);
  assert.deepEqual(Array.from(lines.start), [1 * 8 + 1]);
  assert.ok(Array.from(lines.finish).includes(4 * 8 + 3));
  assert.ok(Array.from(lines.finish).includes(5 * 8 + 3));
  assert.equal(lines.startBoxes.length, 1);
  assert.equal(lines.finishBoxes.length, 1);
  assert.equal(isRaceMap(col), true);
  assert.equal(raceMapLikely(col, false), true);
  assert.equal(raceMapLikely(col, true), false, "a map with a WB is not a race map");

  const hit = raceHit(col, at(1, 1), at(1, 1));
  assert.equal(hit.start, true);
  assert.equal(hit.finish, false);
  assert.equal(raceHit(col, at(3, 4), at(3, 4)).finish, true);
  const noRace = makeMap();
  assert.equal(isRaceMap(noRace), false);
  assert.equal(raceMapLikely(noRace, false), false);
});

test("map analysis reports start/finish, freeze, walls and teleports", () => {
  const col = makeMap({
    width: 8,
    height: 8,
    game: [[1, 1, 33], [6, 1, 34], [3, 1, 35]],
    front: [[2, 2, TILE_FREEZE], [4, 2, TILE_SOLID], [5, 2, TILE_TELEIN]],
  });
  const a = raceMapAnalysis(col);
  assert.equal(a.width, 8);
  assert.equal(a.height, 8);
  assert.equal(a.startTiles, 1);
  assert.equal(a.finishTiles, 1);
  assert.equal(a.startBoxes, 1);
  assert.equal(a.finishBoxes, 1);
  assert.equal(a.timeCps, 1);
  assert.equal(a.freezeTiles, 1);
  assert.equal(a.solidTiles, 1);
  assert.equal(a.teleTiles, 1);
});

test("a blocked map follows a partial route instead of walking into the freeze", () => {
  const width = 40;
  const height = 5;
  const tiles = new Uint8Array(width * height);
  tiles[2 * width + 1] = 33;
  tiles[2 * width + 38] = 34;
  for (let y = 0; y < height; y++) tiles[y * width + 20] = TILE_SOLID;
  const col = new Collision(width, height, tiles);
  const d = driver(col, { legTiles: 6 });
  d.step(tee(at(1, 2)), 1, 0);
  const notes = d.takeNotes();
  assert.ok(notes.some((n) => /partial route/.test(n)), `expected a partial-route note, got: ${notes.join(" | ")}`);
  assert.notEqual(d.leg.to, null, "a waypoint on the partial route is installed");
});

test("RaceClock starts, finishes, restarts and never finishes before a start", () => {
  const col = makeMap({ game: [[1, 1, 33], [5, 5, 34]] });
  const clock = new RaceClock();
  assert.equal(clock.observe(col, at(5, 5), at(5, 5), 1), null, "finish alone does not count");
  assert.equal(clock.observe(col, at(1, 1), at(1, 1), 10), "start");
  assert.equal(clock.state, "started");
  assert.equal(clock.observe(col, at(2, 1), at(2, 1), 20), null);
  assert.equal(clock.observe(col, at(5, 5), at(5, 5), 30), "finish");
  assert.equal(clock.state, "finished");
  assert.equal(clock.time, 20);
  clock.reset();
  assert.equal(clock.state, "none");
  assert.equal(clock.startTick, -1);
  assert.equal(clock.time, -1);
  assert.equal(clock.observe(col, at(1, 1), at(1, 1), 40), "start");
  assert.equal(clock.observe(col, at(5, 5), at(5, 5), 55), "finish");
  assert.equal(clock.time, 15);
});

test("waypoint picks a route step after the span and prefers teleporters", () => {
  const steps = [
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 5, y: 1 },
  ];
  assert.deepEqual(waypoint(steps, { tx: 0, ty: 0 }, 3)?.tile, { tx: 3, ty: 1 });
  assert.equal(waypoint(steps, { tx: 0, ty: 0 }, 99), null);
  assert.deepEqual(waypoint([{ x: 2, y: 2, tele: true }, ...steps], { tx: 0, ty: 0 }, 1), { tile: { tx: 2, ty: 2 }, tele: true });
  assert.deepEqual(waypoint([{ x: 1, y: 1, freeze: true }, { x: 2, y: 1 }], { tx: 0, ty: 0 }, 1)?.tile, undefined);

  const width = 5;
  const field = new Float64Array(width * 3).fill(9);
  field[0] = 4;
  field[1] = 3;
  field[2] = 2;
  field[3] = 1;
  assert.deepEqual(fieldWaypoint(field, width, 3, { tx: 0, ty: 0 }, 2), { tx: 2, ty: 0 });
  assert.equal(fieldWaypoint(field, width, 3, { tx: 4, ty: 2 }, 2), null);
});

test("respawn resets the run clock and the current leg", () => {
  const col = makeMap({ game: [[1, 1, 33], [5, 5, 34]] });
  const d = driver(col);
  d.step(tee(at(1, 1)), 1, 0);
  assert.equal(d.clock.state, "started");
  const goalBefore = d.leg.goal;
  assert.notEqual(goalBefore, null);
  d.step({ ...tee(at(1, 1)), alive: false }, 2, 0);
  d.step(tee(at(2, 2)), 3, 0); // respawn away from the start line
  assert.equal(d.clock.state, "none");
  assert.equal(d.clock.startTick, -1);
  assert.notEqual(d.leg.goal, goalBefore, "a fresh leg is planned after the respawn");
  assert.equal(d.leg.fails, 0);
});

test("a linear map: cross the start, reach the finish, log the time and repeat", () => {
  const col = makeMap({ width: 16, height: 4, game: [[1, 1, 33], [14, 1, 34]] });
  const d = driver(col, { repeatAfterTicks: 10, killCooldownTicks: 1 });
  let tick = 1;
  for (let x = 1; x <= 14; x++) {
    const r = d.step(tee(at(x, 1)), tick++, 0);
    assert.equal(r.kill, false, `unexpected /kill at x=${x}`);
  }
  assert.equal(d.clock.state, "finished");
  assert.equal(d.phase, "done");
  assert.equal(d.clock.time, 12);
  assert.ok(d.takeNotes().some((n) => /finished in/.test(n)), "the run time is written to the log");

  tick += 10;
  const repeat = d.step(tee(at(14, 1)), tick++, 0);
  assert.equal(repeat.kill, true, "a finished run is restarted with /kill");
  d.step({ ...tee(at(14, 1)), alive: false }, tick++, 0);
  d.step(tee(at(1, 1)), tick++, 0);
  assert.equal(d.clock.state, "started", "the next run starts cleanly at the start line");
});

test("deep freeze while moving does not cause a premature /kill", () => {
  const col = makeMap({ game: [[1, 1, 33], [5, 5, 34]] });
  const d = driver(col, { deepKillTicks: 25, stallKillTicks: 1000 });
  let killed = false;
  for (let tick = 1; tick <= 40; tick++) killed ||= d.step(tee(at(2, 2), { deepFrozen: true, vel: { x: 60, y: 0 } }), tick, 0).kill;
  assert.equal(killed, false, "a moving tee in deep freeze is not stuck");

  const frozenCol = makeMap({ game: [[1, 1, 33], [5, 5, 34]], front: [[2, 2, TILE_FREEZE]] });
  const d2 = driver(frozenCol, { deepKillTicks: 25, stallKillTicks: 1000 });
  let stuckKill = -1;
  for (let tick = 1; tick <= 40; tick++) {
    if (d2.step(tee(at(2, 2), { deepFrozen: true, frozen: true, vel: { x: 0, y: 0 } }), tick, 0).kill) {
      stuckKill = tick;
      break;
    }
  }
  assert.ok(stuckKill >= 25, `a tee stuck in deep freeze should be killed after 25 ticks, got ${stuckKill}`);
});

test("a teleporter jump clears freeze/failure timers", () => {
  const col = makeMap({ width: 12, game: [[1, 1, 33], [5, 5, 34]], front: [[2, 1, TILE_FREEZE], [9, 1, TILE_FREEZE]] });
  const d = driver(col, { deepKillTicks: 25, restKillTicks: 25, stallKillTicks: 1000 });
  const frozen = (tx) => tee(at(tx, 1), { deepFrozen: true, frozen: true, vel: { x: 0, y: 0 } });
  for (let tick = 1; tick <= 10; tick++) assert.equal(d.step(frozen(2), tick, 0).kill, false);
  let killed = false;
  for (let tick = 11; tick <= 30; tick++) {
    // A teleport jump (224 px) to another freeze tile at tick 11 restarts both timers.
    killed ||= d.step(frozen(9), tick, 0).kill;
  }
  assert.equal(killed, false, "the /kill timers must restart at the teleport destination");
});

test("a finished run clears the no-way-found verdict", () => {
  const col = makeMap({ game: [[1, 1, 33], [5, 5, 34]] });
  const d = driver(col, { maxLivesWithoutGain: 2 });
  d.lived = true;
  d.respawned();
  d.lived = true;
  d.respawned();
  assert.equal(d.gaveUp, true);
  d.finishedThisLife = true;
  d.lived = true;
  d.respawned();
  assert.equal(d.gaveUp, false);
  assert.equal(d.clock.state, "none");
});

test("a no-way-found verdict is retried after a pause instead of standing forever", () => {
  const col = makeMap({ game: [[1, 1, 33], [5, 5, 34]] });
  const d = driver(col, { maxLivesWithoutGain: 1 });
  d.lived = true;
  d.respawned();
  assert.equal(d.gaveUp, true);
  d.gaveUpAt = 0;
  d.step(tee(at(2, 2)), 30 * 50 + 1, 0);
  assert.equal(d.gaveUp, false);
  assert.ok(d.takeNotes().some((n) => /trying the route again/.test(n)));
});
