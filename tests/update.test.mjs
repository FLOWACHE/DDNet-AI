import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { UPDATE_ENABLED, channelOf, copyChanged, isProtectedName, startAutoUpdate } from "../src/bot/autoUpdate.ts";

const REPO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("updates are off by default and the fork never tracks the upstream repo", () => {
  const source = readFileSync(path.join(REPO, "src", "bot", "autoUpdate.ts"), "utf8");
  assert.doesNotMatch(source, /Wranked1/);
  assert.match(source, /FLOWACHE\/DDNet-AI/);
  assert.match(source, /DDNET_AI_UPDATE/);
  const mode = (process.env.DDNET_AI_UPDATE ?? "off").toLowerCase();
  if (!["on", "1", "true", "yes"].includes(mode)) assert.equal(UPDATE_ENABLED, false);
});

test("updates do not start without an explicit opt-in", async () => {
  const origFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = () => {
    called++;
    throw new Error("no network expected");
  };
  try {
    let events = 0;
    const u = startAutoUpdate(REPO, () => events++, () => assert.fail("quit must not be called"), { enabled: false });
    const r = await u.check();
    assert.equal(r.kind, "stopped");
    assert.match(r.text, /выключен/);
    assert.equal(events, 0);
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("protected paths cannot be taken from an update archive", () => {
  for (const name of ["settings.json", "data", "data/settings.json", "userdata", "cache", "tests", "runs", ".version", ".git"]) {
    assert.equal(isProtectedName(name), true, name);
  }
  for (const name of ["src", "app", "start.mjs", "tools", "README.md"]) assert.equal(isProtectedName(name), false, name);
  assert.equal(channelOf("").repo, "FLOWACHE/DDNet-AI");

  const dir = mkdtempSync(path.join(REPO, "cache", "update-test-"));
  try {
    mkdirSync(path.join(dir, "from"));
    writeFileSync(path.join(dir, "from", "settings.json"), "{}");
    assert.throws(() => copyChanged(path.join(dir, "from", "settings.json"), path.join(dir, "settings.json")), /protected/);
    assert.equal(existsSync(path.join(dir, "settings.json")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
