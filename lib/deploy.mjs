// Deep deployment: render the splash from the current config, repack app.asar
// into a pending file, and swap it in on the next host start (applyPending).

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readAsar, readFileFromAsar, repackAsar } from "./asar.mjs";
import { renderSplash } from "./render.mjs";
import { hasHook, injectHook } from "./hook.mjs";
import { writeState, readState, readConfig } from "./store.mjs";

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

export function resolvePaths(overrides = {}) {
  const resources = overrides.resources ?? process.resourcesPath;
  const appDir = path.dirname(resources);
  return {
    resources,
    appDir,
    asar: path.join(resources, "app.asar"),
    backup: path.join(resources, "app.asar.rsa-backup"),
    pending: path.join(resources, "app.asar.rsa-new"),
    exe: overrides.exe ?? process.execPath,
  };
}

function readLogoData(customPath, fallbackSvg) {
  // A custom logo is embedded into the splash module, so cap the size and pick
  // the MIME type from the extension instead of trusting any file on disk.
  if (customPath && fs.existsSync(customPath)) {
    try {
      const stat = fs.statSync(customPath);
      if (stat.isFile() && stat.size > 0 && stat.size <= 10 * 1024 * 1024) {
        const ext = path.extname(customPath).toLowerCase();
        const mime =
          ext === ".svg"
            ? "image/svg+xml"
            : ext === ".jpg" || ext === ".jpeg"
              ? "image/jpeg"
              : ext === ".webp"
                ? "image/webp"
                : "image/png";
        return `data:${mime};base64,` + fs.readFileSync(customPath).toString("base64");
      }
    } catch {}
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
export function inspect(overrides = {}) {
  const paths = resolvePaths(overrides);
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
    const liveSplash = lookupOrNull(asar, SPLASH_MODULE);
    info.hasRsaModule = Boolean(liveSplash);
    info.installed = info.hooked && info.hasRsaModule;
    // "installed" only says a splash module exists; it may have been generated
    // from an older config or an older renderer. Compare it with what a deploy
    // right now would write so the UI can ask for a redeploy.
    if (liveSplash) {
      try {
        const current = readConfig(overrides.dataDir);
        info.stale = liveSplash.toString("utf8") !== renderSplash(current, loadLogos(current));
      } catch {
        info.stale = null;
      }
    }
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
 * Build the pending asar next to the live one. The swap happens on the next
 * host start (applyPending); this plugin never restarts DSH.
 *
 * `overrides` (resources / exe / dataDir) lets tests point the deploy at a
 * fixture directory instead of the running installation.
 */
export async function deploy(config, overrides = {}) {
  const paths = resolvePaths(overrides);
  const dataDir = overrides.dataDir ?? DATA_DIR;
  const result = { ok: false, needsRestart: true, asar: paths.asar, backup: paths.backup, pending: paths.pending, error: null };

  // The splash window is only rendered by the Windows build (see render.mjs);
  // a deep deploy anywhere else would rewrite app.asar and show nothing.
  if (process.platform !== "win32") {
    result.needsRestart = false;
    result.error = `deep deployment is Windows-only (current platform: ${process.platform}); the splash window is only rendered by the Windows desktop build`;
    return result;
  }

  if (!fs.existsSync(paths.asar)) {
    result.error = `app.asar not found: ${paths.asar}`;
    return result;
  }

  let asar;
  let newSize = 0;
  let hookInjected = false;
  try {
    asar = readAsar(paths.asar);

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

    const state = writeState(
      {
        lastDeployAt: new Date().toISOString(),
        lastDeployConfig: config,
        pendingAsar: paths.pending,
        pendingSize: newSize,
      },
      dataDir,
    );
    result.ok = true;
    result.staged = true;
    result.newSize = newSize;
    result.state = state;
    result.message = hookInjected
      ? "Deployment files prepared and the splash hook was installed into the app entry. Restart DeepSeek Harness to apply the splash (this plugin never restarts DSH for you)."
      : "Deployment files prepared. Restart DeepSeek Harness to apply the splash (this plugin never restarts DSH for you).";
    return result;
  } catch (error) {
    // Never leave a half-built pending asar behind: applyPending() copies any
    // pending file over the live app.asar on the next start, so a file that
    // failed validation would poison the installation.
    try {
      if (fs.existsSync(paths.pending)) fs.unlinkSync(paths.pending);
    } catch {}
    result.needsRestart = false;
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  } finally {
    if (asar) {
      try {
        fs.closeSync(asar.fd);
      } catch {}
    }
  }
}

/** null when the pending archive looks usable, otherwise the reason. */
function pendingProblem(pendingPath) {
  let pending;
  try {
    pending = readAsar(pendingPath);
    const mainEntry = resolveMainEntry(pending);
    const main = readFileFromAsar(pending, mainEntry).toString("utf8");
    if (!hasHook(main)) return `pending asar has no splash hook in ${mainEntry}`;
    readFileFromAsar(pending, SPLASH_MODULE);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    if (pending) {
      try {
        fs.closeSync(pending.fd);
      } catch {}
    }
  }
}

/** null when the pending archive was built from the host version still installed. */
function hostVersionProblem(pendingPath, livePath) {
  const readVersion = (asarPath) => {
    let asar;
    try {
      asar = readAsar(asarPath);
      return JSON.parse(readFileFromAsar(asar, "package.json").toString("utf8")).version ?? "";
    } catch {
      return "";
    } finally {
      if (asar) {
        try {
          fs.closeSync(asar.fd);
        } catch {}
      }
    }
  };
  const pendingVersion = readVersion(pendingPath);
  const liveVersion = readVersion(livePath);
  if (pendingVersion && liveVersion && pendingVersion !== liveVersion) {
    return `host app.asar changed since deployment (${pendingVersion} -> ${liveVersion}); pending deployment discarded, deploy again after the upgrade`;
  }
  return null;
}

/**
 * Apply a previously prepared pending asar. Called from the host plugin on
 * startup; never restarts the app. A pending file that is stale (built from a
 * different host version) or damaged is discarded instead of copied over the
 * live archive. Returns a small status object.
 */
export function applyPending(overrides = {}) {
  const paths = resolvePaths(overrides);
  const dataDir = overrides.dataDir ?? DATA_DIR;
  const out = { ok: false, applied: false, skipped: true, error: null };

  if (!fs.existsSync(paths.pending)) return out;
  out.skipped = false;

  const problem = pendingProblem(paths.pending) ?? hostVersionProblem(paths.pending, paths.asar);
  if (problem) {
    out.error = problem;
    // A pending file that cannot be trusted must not stay armed for the next start.
    try {
      fs.unlinkSync(paths.pending);
    } catch {}
    return out;
  }

  const staged = `${paths.asar}.rsa-tmp`;
  try {
    if (!fs.existsSync(paths.backup)) {
      fs.copyFileSync(paths.asar, paths.backup);
    }
    // Write next to the live archive and rename it into place: if the swap
    // fails, the live app.asar is untouched and the pending file stays armed.
    // A direct copy would truncate the live archive first and a crash midway
    // leaves a host that cannot start.
    try {
      fs.unlinkSync(staged);
    } catch {}
    fs.copyFileSync(paths.pending, staged);
    try {
      fs.renameSync(staged, paths.asar);
    } catch (renameError) {
      // Some Windows installs keep the archive open without rename rights;
      // fall back to the old copy path instead of refusing to apply.
      fs.copyFileSync(staged, paths.asar);
      fs.unlinkSync(staged);
    }
    fs.unlinkSync(paths.pending);
    out.applied = true;
    out.ok = true;
    writeState(
      { ...readState(dataDir), lastAppliedAt: new Date().toISOString(), pendingAsar: null },
      dataDir,
    );
  } catch (error) {
    // Keep the pending file: a locked live archive may succeed on the next start.
    try {
      fs.unlinkSync(staged);
    } catch {}
    out.error = error instanceof Error ? error.message : String(error);
  }
  return out;
}

