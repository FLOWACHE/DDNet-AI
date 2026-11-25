import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import dataPaths from "../app/lib/dataPaths.js";

const REPO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const env = { DDNET_AI_HOME: "", DDNET_AI_CACHE_DIR: "", DDNET_AI_USER_DATA: "" };

test("default layout keeps code, data, runs and caches under the repository", () => {
  const p = dataPaths.pathsOf({ repoDir: REPO, env, argv: [] });
  assert.equal(p.repo, REPO);
  assert.equal(p.data, path.join(REPO, "data"));
  assert.equal(p.settings, path.join(REPO, "data", "settings.json"));
  assert.equal(p.maps, path.join(REPO, "data", "maps"));
  assert.equal(p.runs, path.join(REPO, "data", "runs"));
  assert.equal(p.routes, path.join(REPO, "data", "runs", "routes"));
  assert.equal(p.gores, path.join(REPO, "data", "runs", "routes", "gores"));
  assert.equal(p.clips, path.join(REPO, "data", "runs", "clips"));
  assert.equal(p.memory, path.join(REPO, "data", "runs", "memory"));
  assert.equal(p.cache, path.join(REPO, "cache"));
  assert.equal(p.userData, path.join(REPO, "userdata"));
  assert.equal(p.reports, path.join(REPO, "data", "reports"));
  for (const name of ["avoid", "masterCache", "crash", "duels", "autoChat", "relations", "ab"]) {
    assert.equal(path.dirname(p[name]), p.runs, `${name} belongs in data/runs`);
  }
  if (process.platform === "win32") assert.match(p.data, /^[A-Za-z]:\\/, "data is on a local drive");
});

test("--data-dir wins over DDNET_AI_HOME; relative values resolve against the repo", () => {
  const p = dataPaths.pathsOf({ repoDir: REPO, env: { DDNET_AI_HOME: "other" }, argv: ["--data-dir", "custom-data"] });
  assert.equal(p.data, path.join(REPO, "custom-data"));
  const q = dataPaths.pathsOf({ repoDir: REPO, env: { DDNET_AI_HOME: "D:\\elsewhere" }, argv: [] });
  assert.equal(q.data, path.resolve("D:\\elsewhere"));
});
