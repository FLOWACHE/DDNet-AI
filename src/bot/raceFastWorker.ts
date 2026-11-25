import { parentPort, workerData } from "node:worker_threads";
import { Collision } from "../core/collision.ts";
import { setFloat32 } from "../core/float.ts";
import { GOALS_KEPT_SOLVER, goresSource } from "../plan/goresMap.ts";
import { solveRaceFast } from "../plan/raceFast.ts";
import type { FastSolveOpts } from "../plan/raceFast.ts";

setFloat32(true);

const port = parentPort;
if (port === null) throw new Error("raceFastWorker.ts runs only as a worker thread");

const init = workerData as { snapshot: ReturnType<Collision["snapshot"]>; opts?: FastSolveOpts };

try {
  const col = Collision.fromSnapshot(init.snapshot);
  const source = goresSource(col, GOALS_KEPT_SOLVER, true);
  if (source === null) port.postMessage({ t: "failed", why: "no course" });
  else {
    const sol = solveRaceFast(col, source, {
      ...init.opts,
      onSection: (done, total) => port.postMessage({ t: "progress", done, total }),
    });
    port.postMessage({ t: "done", sol });
  }
} catch (err) {
  port.postMessage({ t: "failed", why: err instanceof Error ? err.message : String(err) });
}
