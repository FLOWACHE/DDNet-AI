import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mutable state lives under <repo>/data, temporary files under <repo>/cache.
// start.mjs (and the Electron window) pass the resolved directories explicitly
// so --data-dir / DDNET_AI_HOME work for every part of the bot.
const REPO = fileURLToPath(new URL("../../", import.meta.url));

export const REPO_DIR = path.resolve(REPO);
export const DATA_DIR = path.resolve(process.env.DDNET_AI_DATA_DIR || process.env.DDNET_AI_HOME || path.join(REPO_DIR, "data"));
export const CACHE_DIR = path.resolve(process.env.DDNET_AI_CACHE_DIR || path.join(REPO_DIR, "cache"));

export function tempDir(prefix: string): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  return mkdtempSync(path.join(CACHE_DIR, prefix));
}
