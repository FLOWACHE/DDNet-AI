import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { DdnetBot, commandSpecs } from "../src/bot/bot.ts";

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
