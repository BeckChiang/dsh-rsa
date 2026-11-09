// Deep deployment: render the splash from the current config, repack app.asar,
// then schedule a detached apply script that swaps the file and restarts DSH.

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readAsar, readFileFromAsar, repackAsar } from "./asar.mjs";
import { renderSplash } from "./render.mjs";
import { hasHook, injectHook } from "./hook.mjs";
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

const SPLASH_MODULE = "lib/splash.cjs";
const DEFAULT_MAIN = "lib/main.js";

/**
 * The host entry that has to import the splash module. Read from the asar's own
 * package.json so a renamed/restructured entry still works; falls back to the
 * long-standing lib/main.js.
 */
export function resolveMainEntry(asar) {
  let main = "";
  try {
    main = JSON.parse(readFileFromAsar(asar, "package.json").toString("utf8")).main || "";
  } catch {}
  const entry = String(main).trim().replace(/^\.\//, "").replace(/\\/g, "/");
  return entry || DEFAULT_MAIN;
}

/** Import specifier of the splash module, relative to the host entry's folder. */
function splashSpecifier(mainEntry) {
  const relative = path.posix.relative(path.posix.dirname(mainEntry), SPLASH_MODULE);
  return relative.startsWith("./") || relative.startsWith("../") ? relative : `./${relative}`;
}

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
    const mainEntry = resolveMainEntry(asar);
    info.mainEntry = mainEntry;
    const main = lookupOrNull(asar, mainEntry);
    if (main) info.hooked = hasHook(main.toString("utf8"));
    info.hasRsaModule = Boolean(lookupOrNull(asar, SPLASH_MODULE));
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
  let hookInjected = false;
  try {
    // First deploy, and every deploy after a host upgrade wiped the patch: prepend
    // the one-line hook ourselves instead of asking the user for an installer.
    const mainEntry = resolveMainEntry(asar);
    const mainSrc = readFileFromAsar(asar, mainEntry).toString("utf8");
    const patched = injectHook(mainSrc, splashSpecifier(mainEntry));
    hookInjected = patched.injected;
    result.mainEntry = mainEntry;
    result.hookInjected = patched.injected;

    if (!fs.existsSync(paths.backup)) {
      fs.copyFileSync(paths.asar, paths.backup);
      result.backupCreated = true;
    }

    const logos = loadLogos(config);
    const moduleSrc = renderSplash(config, logos);
    const replacements = new Map([[SPLASH_MODULE, Buffer.from(moduleSrc, "utf8")]]);
    if (patched.injected) replacements.set(mainEntry, Buffer.from(patched.source, "utf8"));
    const repacked = repackAsar(asar, paths.pending, replacements);
    newSize = repacked.size;

    // Sanity: the new asar must expose the module and carry the hook.
    const check = readAsar(paths.pending);
    try {
      const written = readFileFromAsar(check, SPLASH_MODULE).toString("utf8");
      if (written !== moduleSrc) throw new Error("repacked splash module does not match generated module");
      const writtenMain = readFileFromAsar(check, mainEntry).toString("utf8");
      if (!hasHook(writtenMain)) throw new Error(`repacked ${mainEntry} has no splash hook`);
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
  result.message = hookInjected
    ? "Deployment files prepared and the splash hook was installed into the app entry. Restart DeepSeek Harness to apply the splash (this plugin never restarts DSH for you)."
    : "Deployment files prepared. Restart DeepSeek Harness to apply the splash (this plugin never restarts DSH for you).";
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

