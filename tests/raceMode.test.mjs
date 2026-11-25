import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DdnetBot, commandSpecs } from "../src/bot/bot.ts";

const REPO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const allowed = (cfg) => DdnetBot.prototype.raceAllowed.call({ cfg });

test("race is on by default and gores keeps its own gate", () => {
  assert.equal(allowed({}), true);
  assert.equal(allowed({ race: true }), true);
  assert.equal(allowed({ race: false }), false);
  assert.equal(DdnetBot.prototype.goresAllowed.call({ cfg: {} }), false);
  assert.equal(DdnetBot.prototype.goresAllowed.call({ cfg: { gores: true } }), true);
});

test("DDNET_AI_RACE=0 is an explicit opt-out, DDNET_AI_RACE=1 is not needed", () => {
  const probe = `import { DdnetBot } from "./src/bot/bot.ts"; console.log(String(DdnetBot.prototype.raceAllowed.call({ cfg: {} })));`;
  const run = (env) => execFileSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: process.cwd(), env: { ...process.env, DDNET_AI_RACE: env }, encoding: "utf8" }).trim();
  assert.equal(run(""), "true");
  assert.equal(run("1"), "true");
  assert.equal(run("0"), "false");
});

test("!race on/off, !style race and !mode race work with no environment variable", () => {
  const dir = mkdtempSync(path.join(REPO, "cache", "race-mode-test-"));
  try {
    const bot = new DdnetBot({
      host: "127.0.0.1",
      port: 8303,
      name: "T",
      mapDir: path.join(REPO, "data", "maps"),
      scripted: true,
      settingsFile: path.join(dir, "settings.json"),
      relationsFile: path.join(dir, "relations.json"),
    });
    assert.match(bot.handleConsole("!race"), /!race on \| off/);
    assert.match(bot.handleConsole("!style race"), /race: on/);
    assert.match(bot.handleConsole("!mode"), /mode: race/);
    const help = bot.handleConsole("!help");
    assert.match(help, /!race on\|off/);
    assert.match(help, /!style .*race/);
    assert.match(bot.handleConsole("!race off"), /race: off/);
    assert.match(bot.handleConsole("!mode"), /mode: fight/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the race button is always visible and enabled only on race-like maps", () => {
  const page = readFileSync(path.join(REPO, "src", "bot", "page", "page.js"), "utf8");
  assert.doesNotMatch(page, /rb\.hidden=!raceTest/);
  assert.doesNotMatch(page, /btns\.race\.hidden=true/);
  assert.doesNotMatch(page, /sb\.race\.hidden=!pn\.raceTest/);
  assert.match(page, /rb\.hidden=false;rb\.disabled=!raceOk/);
  assert.match(page, /sb\.race\.hidden=false/);
  assert.match(page, /race:t\('Гонка: бежит от старта до финиша/);
});

test("race commands and help do not call the mode a test feature", () => {
  const identity = (s) => s;
  const specs = commandSpecs(identity, true, false);
  for (const name of ["style", "mode"]) {
    const desc = specs.find((s) => s.name === name)?.desc ?? "";
    assert.match(desc, /гонка/);
    assert.doesNotMatch(desc, /тест/, `${name} help mentions a test`);
  }
  const both = commandSpecs(identity, true, true);
  const style = both.find((s) => s.name === "style")?.desc ?? "";
  assert.match(style, /гонка/);
  assert.match(style, /gores:.*тест/, "gores is still labelled as a test mode");
});
