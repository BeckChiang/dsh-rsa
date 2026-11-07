// Deep deployment: render the splash from the current config, repack app.asar,
// then schedule a detached apply script that swaps the file and restarts DSH.

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readAsar, readFileFromAsar, repackAsar } from "./asar.mjs";
import { renderSplash } from "./render.mjs";
import { writeState, readState } from "./store.mjs";

// See asar.mjs: Electron's patched fs treats every ".asar" path as an archive
// path; original-fs is the unpatched module and can touch the archive file.
const require = createRequire(import.meta.url);
let fs;
try {
  fs = require("original-fs");
} catch {
  fs = require("node:fs");
}

const LIB_DIR = fileURLToPath(new URL("./", import.meta.url));
const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

const HOOK_MARKERS = ["./splash.cjs", "./rsa-splash.cjs"];

export function resolvePaths() {
  const resources = process.resourcesPath;
  const appDir = path.dirname(resources);
  return {
    resources,
    appDir,
    asar: path.join(resources, "app.asar"),
    backup: path.join(resources, "app.asar.rsa-backup"),
    pending: path.join(resources, "app.asar.rsa-new"),
    exe: process.execPath,
    applyScript: path.join(DATA_DIR, "apply-rsa.ps1"),
  };
}

function readLogoData(customPath, fallbackSvg) {
  if (customPath && fs.existsSync(customPath)) {
    return "data:image/png;base64," + fs.readFileSync(customPath).toString("base64");
  }
  const svg = fs.readFileSync(path.join(LIB_DIR, fallbackSvg), "utf8");
  return "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
}

export function loadLogos(config) {
  return {
    light: readLogoData(config.logo.customLight, "brand-light.svg"),
    dark: readLogoData(config.logo.customDark, "brand-dark.svg"),
  };
}

/** Inspect the installed asar: does it carry the splash hook, and our module? */
export function inspect() {
  const paths = resolvePaths();
  const state = readState();
  const info = {
    ok: false,
    asarPath: paths.asar,
    asarSize: 0,
    installed: false,
    hooked: false,
    hasRsaModule: false,
    backupExists: fs.existsSync(paths.backup),
    pendingExists: fs.existsSync(paths.pending),
    lastDeployAt: state.lastDeployAt ?? null,
    error: null,
  };
  let asar;
  try {
    if (!fs.existsSync(paths.asar)) throw new Error(`app.asar not found: ${paths.asar}`);
    info.asarSize = fs.statSync(paths.asar).size;
    asar = readAsar(paths.asar);
    const main = lookupOrNull(asar, "lib/main.js");
    if (main) {
      const text = main.toString("utf8");
      info.hooked = HOOK_MARKERS.some((marker) => text.includes(marker));
    }
    info.hasRsaModule = Boolean(lookupOrNull(asar, "lib/splash.cjs"));
    info.installed = info.hooked && info.hasRsaModule;
    info.ok = true;
  } catch (error) {
    info.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (asar) {
      try {
        fs.closeSync(asar.fd);
      } catch {}
    }
  }
  return info;
}

function lookupOrNull(asar, filePath) {
  try {
    return readFileFromAsar(asar, filePath);
  } catch {
    return null;
  }
}

/**
 * Build the new asar and schedule its replacement. Returns a status object; the
 * actual swap happens in a detached PowerShell after the desktop app exits.
 */
export async function deploy(config) {
  const paths = resolvePaths();
  const result = { ok: false, needsRestart: true, asar: paths.asar, backup: paths.backup, pending: paths.pending, error: null };

  if (!fs.existsSync(paths.asar)) {
    result.error = `app.asar not found: ${paths.asar}`;
    return result;
  }

  const asar = readAsar(paths.asar);
  let newSize = 0;
  try {
    const main = readFileFromAsar(asar, "lib/main.js").toString("utf8");
    if (!HOOK_MARKERS.some((marker) => main.includes(marker))) {
      result.error =
        "The installed app.asar has no splash hook (lib/main.js). DSH was probably upgraded and reset the patch; re-run the v7 hook installer first.";
      return result;
    }

    if (!fs.existsSync(paths.backup)) {
      fs.copyFileSync(paths.asar, paths.backup);
      result.backupCreated = true;
    }

    const logos = loadLogos(config);
    const moduleSrc = renderSplash(config, logos);
    const replacements = new Map([["lib/splash.cjs", Buffer.from(moduleSrc, "utf8")]]);
    const repacked = repackAsar(asar, paths.pending, replacements);
    newSize = repacked.size;

    // Sanity: the new asar must expose the same splash module bytes.
    const check = readAsar(paths.pending);
    try {
      const written = readFileFromAsar(check, "lib/splash.cjs").toString("utf8");
      if (written !== moduleSrc) throw new Error("repacked splash module does not match generated module");
    } finally {
      try {
        fs.closeSync(check.fd);
      } catch {}
    }
  } finally {
    try {
      fs.closeSync(asar.fd);
    } catch {}
  }

  const state = writeState({
    lastDeployAt: new Date().toISOString(),
    lastDeployConfig: config,
    pendingAsar: paths.pending,
    pendingSize: newSize,
  });
  result.ok = true;
  result.pending = true;
  result.newSize = newSize;
  result.state = state;
  result.message =
    "Deployment files prepared. Restart DeepSeek Harness to apply the splash (this plugin never restarts DSH for you).";
  return result;
}

/**
 * Apply a previously prepared pending asar. Called from the host plugin on
 * startup; never restarts the app. Returns a small status object.
 */
export function applyPending() {
  const paths = resolvePaths();
  const out = { ok: false, applied: false, skipped: true, error: null };
  try {
    if (!fs.existsSync(paths.pending)) return out;
    out.skipped = false;
    if (!fs.existsSync(paths.backup)) {
      fs.copyFileSync(paths.asar, paths.backup);
    }
    fs.copyFileSync(paths.pending, paths.asar);
    fs.unlinkSync(paths.pending);
    out.applied = true;
    out.ok = true;
    writeState({ ...readState(), lastAppliedAt: new Date().toISOString(), pendingAsar: null });
  } catch (error) {
    out.error = error instanceof Error ? error.message : String(error);
  }
  return out;
}

