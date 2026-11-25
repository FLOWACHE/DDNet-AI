"use strict";

// One place for the on-disk layout of the fork. CODE (repository) and DATA
// (mutable state) are deliberately separate: nothing the bot writes should
// need to touch the source tree. Defaults assume the repository lives on D:.

const path = require("node:path");

function argValue(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return null;
}

function repoDirOf(repoDir) {
  return path.resolve(repoDir ?? path.join(__dirname, "..", ".."));
}

function dataDirOf({ env = process.env, argv = process.argv, repoDir } = {}) {
  const repo = repoDirOf(repoDir);
  const override = argValue(argv, "data-dir") || env.DDNET_AI_HOME;
  return override ? path.resolve(repo, override) : path.join(repo, "data");
}

function pathsOf(opts = {}) {
  const env = opts.env ?? process.env;
  const repo = repoDirOf(opts.repoDir);
  const data = dataDirOf({ ...opts, env, repoDir: repo });
  const runs = path.join(data, "runs");
  const abs = (v, fallback) => (v ? path.resolve(repo, v) : fallback);
  return {
    repo,
    data,
    runs,
    cache: abs(env.DDNET_AI_CACHE_DIR, path.join(repo, "cache")),
    userData: abs(env.DDNET_AI_USER_DATA, path.join(repo, "userdata")),
    settings: path.join(data, "settings.json"),
    maps: path.join(data, "maps"),
    routes: path.join(runs, "routes"),
    gores: path.join(runs, "routes", "gores"),
    dummy: path.join(runs, "dummy"),
    clips: path.join(runs, "clips"),
    memory: path.join(runs, "memory"),
    relations: path.join(runs, "relations.json"),
    duels: path.join(runs, "duels.json"),
    autoChat: path.join(runs, "autochat.json"),
    announce: path.join(runs, "announced.json"),
    ab: path.join(runs, "ab.json"),
    avoid: path.join(runs, "server-avoid.json"),
    masterCache: path.join(runs, "master-cache.json"),
    crash: path.join(runs, "last-crash.txt"),
    reports: path.join(data, "reports"),
    version: path.join(repo, ".version"),
  };
}

module.exports = { argValue, repoDirOf, dataDirOf, pathsOf };
