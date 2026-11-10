// Persistence helpers for RSA: config file + deploy state, kept in the plugin's
// data directory so nothing outside the workspace is touched.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfig, DEFAULTS } from "./defaults.mjs";

export const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

export function readConfig(dir = DATA_DIR) {
  try {
    const raw = fs.readFileSync(path.join(dir, "config.json"), "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return normalizeConfig(DEFAULTS);
  }
}

export function writeConfig(config, dir = DATA_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const normalized = normalizeConfig(config);
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

export function resetConfig() {
  return writeConfig(DEFAULTS);
}

export function readState(dir = DATA_DIR) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  } catch {
    return {};
  }
}

export function writeState(state, dir = DATA_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const merged = { ...readState(dir), ...state, updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
