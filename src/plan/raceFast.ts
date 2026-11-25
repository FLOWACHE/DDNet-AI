import { float32 } from "../core/float.ts";
import type { Collision } from "../core/collision.ts";
import { FLAT_POS_X, FLAT_POS_Y, FLAT_STRIDE } from "../core/world.ts";
import type { CourseSource, MapSolution, SolvedSection } from "./goresMap.ts";
import { SOLUTION_VERSION, PHYSICS_VERSION } from "./goresMap.ts";
import { DRILL_SEARCH, PERSONALITIES } from "./goresSolver.ts";
import { MACRO_ROOT, PathSearcher } from "./pathfind.ts";

export type FastSolveOpts = {
  cutTiles?: number;
  timeLimitMs?: number;
  maxExpansions?: number;
  onSection?: (done: number, total: number) => void;
};

/**
 * A fast, synchronous version of the gores solver for race maps: solve one
 * section at a time with the same physics search, keep the verified prefix,
 * and return as soon as the budget for a section is spent. No polishing, no
 * backtracking: the bot can replay what is already known instead of standing.
 */
export function solveRaceFast(col: Collision, source: CourseSource, opts: FastSolveOpts = {}): MapSolution {
  if (!float32) throw new Error("the fast race solver needs the float physics");
  const cut = Math.max(24, Math.round(opts.cutTiles ?? 160));
  const limit = Math.max(250, Math.round(opts.timeLimitMs ?? 4000));
  const expansions = Math.max(1000, Math.round(opts.maxExpansions ?? 200_000));
  const sections = source.cut(cut);
  let state = source.spawn;
  const solved: SolvedSection[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const goal = source.goal(sec, 12);
    const here = { tx: Math.floor(state[FLAT_POS_X] / 32), ty: Math.floor(state[FLAT_POS_Y] / 32) };
    let route = null;
    for (const person of [{ search: {}, lookahead: 1 }, ...PERSONALITIES]) {
      const searcher = new PathSearcher(col, goal, { ...DRILL_SEARCH, ...source.search, ...person.search, maxExpansions: expansions, timeLimitMs: limit }, here);
      route = searcher.search(state, MACRO_ROOT, expansions * 5);
      if (route !== null) break;
    }
    if (route === null) break;
    const n = route.ticks;
    const stride = FLAT_STRIDE;
    solved.push({
      idx: solved.length,
      from: sec.from,
      to: sec.to,
      startState: state.slice(),
      codes: [...route.codes],
      edgeTicks: [...route.edgeTicks],
      inputs: route.inputs,
      endState: route.states.slice(n * stride, (n + 1) * stride),
      ticks: n,
      ahead: 0,
      copiesHeld: 0,
    });
    state = route.states.slice(n * stride, (n + 1) * stride);
    opts.onSection?.(solved.length, sections.length);
  }
  const complete = solved.length === sections.length && solved.length > 0;
  const bestTicks = solved.reduce((a, s) => a + s.ticks, 0);
  return {
    version: SOLUTION_VERSION,
    physicsVersion: PHYSICS_VERSION,
    key: "",
    cutEvery: cut,
    sections: solved,
    solvedPrefix: solved.length,
    total: sections.length,
    complete,
    bestTicks,
    attempts: solved.length,
  };
}
