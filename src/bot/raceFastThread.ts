import { Worker } from "node:worker_threads";
import type { Collision } from "../core/collision.ts";
import type { MapSolution } from "../plan/goresMap.ts";
import type { FastSolveOpts } from "../plan/raceFast.ts";

export type RaceFastStatus = {
  state: "off" | "solving" | "done" | "failed";
  done: number;
  total: number;
  note: string;
};

/** Runs the fast race path search off the bot's tick thread. */
export class RaceFastHost {
  private worker: Worker | null = null;
  private sol: MapSolution | null = null;
  private cur: RaceFastStatus = { state: "off", done: 0, total: 0, note: "" };
  onChange?: () => void;

  get running(): boolean {
    return this.worker !== null;
  }

  status(): RaceFastStatus {
    return this.cur;
  }

  solution(): MapSolution | null {
    return this.sol;
  }

  start(col: Collision, opts: Omit<FastSolveOpts, "onSection"> = {}): void {
    this.cancel();
    this.sol = null;
    this.cur = { state: "solving", done: 0, total: 0, note: "starting" };
    const worker = new Worker(new URL("./raceFastWorker.ts", import.meta.url), {
      workerData: { snapshot: col.snapshot(), opts },
    });
    worker.unref();
    worker.on("message", (m: { t: string; done?: number; total?: number; sol?: MapSolution; why?: string }) => {
      if (m.t === "progress") this.cur = { ...this.cur, done: m.done ?? 0, total: m.total ?? 0, note: `solved ${m.done ?? 0} of ${m.total ?? 0} sections` };
      else if (m.t === "done" && m.sol !== undefined) {
        this.sol = m.sol;
        this.cur = { state: "done", done: m.sol.solvedPrefix, total: m.sol.total, note: m.sol.complete ? "whole path solved" : "partial path solved" };
        this.finish();
      } else if (m.t === "failed") {
        this.cur = { state: "failed", done: this.cur.done, total: this.cur.total, note: m.why ?? "failed" };
        this.finish();
      }
      try {
        this.onChange?.();
      } catch {
      }
    });
    worker.on("error", (err) => {
      this.cur = { state: "failed", done: this.cur.done, total: this.cur.total, note: err.message };
      this.finish();
    });
    this.worker = worker;
  }

  private finish(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  cancel(): void {
    this.finish();
    this.worker = null;
    this.cur = { state: "off", done: 0, total: 0, note: "" };
  }
}
