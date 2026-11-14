// Real startup animation (RSA) — host side.
// Serves the settings API under /rsa and performs deep deployment into app.asar.

import { readConfig, writeConfig, resetConfig, readState, writeState } from "./lib/store.mjs";
import { DEFAULTS, normalizeConfig } from "./lib/defaults.mjs";
import { buildHtml } from "./lib/render.mjs";
import { deploy, inspect, loadLogos, resolvePaths, applyPending } from "./lib/deploy.mjs";
import { checkCompatibility, compatStatus } from "./lib/compat.mjs";
import { ensureRollbackScript, rollbackPath, rollbackExists } from "./lib/rollback.mjs";

// --- path overrides (tests only) --------------------------------------------

// Production always resolves the live install from process.resourcesPath. Tests
// point the same routes at a temp fixture through this setter — deliberately
// not through the cordis context, whose proxy throws on undeclared props.
let pathOverrides = {};

export function setPathOverrides(overrides) {
  pathOverrides = overrides || {};
  return pathOverrides;
}

// --- compatibility bookkeeping ----------------------------------------------

function compatibilityStatus(overrides = {}) {
  try {
    return compatStatus(resolvePaths(overrides).asar, readState(overrides.dataDir));
  } catch (error) {
    return { needed: true, reason: "no-host", hostVersion: null, hostError: error instanceof Error ? error.message : String(error) };
  }
}

function recordCompat(report, full, overrides = {}) {
  try {
    writeState({
      lastCompatAt: new Date().toISOString(),
      lastCompatHostVersion: report && report.hostVersion ? report.hostVersion : null,
      lastCompatOk: Boolean(report && report.ok === true),
      lastCompatFull: full === true,
      lastCompatError: report && report.error ? String(report.error) : null,
    }, overrides.dataDir);
  } catch (error) {
    console.log("[rsa] could not record the compatibility result:", error && error.message ? error.message : String(error));
  }
}

// Runs the full check (round-trip included) and remembers it. Called before
// every deployment and once automatically when the host build is new to us.
function runFullCheck(overrides = {}) {
  const report = checkCompatibility(overrides, { full: true });
  recordCompat(report, true, overrides);
  return report;
}

export const name = "dsh-rsa";
export const inject = ["webServer"];

const ROUTE = "/rsa";

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.byteLength),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function sendHtml(res, html) {
  const body = Buffer.from(html, "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(body.byteLength),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 2 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseUrl(req) {
  try {
    return new URL(req.url ?? ROUTE, "http://rsa.local");
  } catch {
    return new URL(ROUTE, "http://rsa.local");
  }
}

function previewHtml(themeParam) {
  const config = readConfig();
  const logos = loadLogos(config);
  const mode = config.theme.mode;
  const theme = themeParam === "dark" || themeParam === "light" ? themeParam : mode === "light" ? "light" : "dark";
  return buildHtml(config, logos, theme);
}

/**
 * Reject cross-site writes. Browsers always attach Sec-Fetch-Site to fetch()
 * and form posts, so a page the user visits cannot rewrite the config or arm a
 * deploy; non-browser clients (curl) send no such header and keep working.
 */
function isCrossSiteWrite(req) {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.origin;
  if (origin) {
    try {
      return new URL(origin).host !== req.headers.host;
    } catch {
      return true;
    }
  }
  return false;
}

export async function handle(ctx, req, res) {
  // Never read `ctx.<anything>` here: the cordis context is a proxy that throws
  // "cannot get property ... without inject" for undeclared props, and that
  // message was surfacing straight into the settings page. Path overrides are a
  // test-only hook kept in a module variable instead.
  const overrides = pathOverrides;
  const url = parseUrl(req);
  const pathname = url.pathname;

  if (isCrossSiteWrite(req)) {
    sendJson(res, 403, { ok: false, error: "cross-site request rejected" });
    return;
  }

  if (pathname === `${ROUTE}/state` && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      config: readConfig(),
      defaults: DEFAULTS,
      inspect: inspect(overrides),
      state: readState(overrides.dataDir),
      compat: compatibilityStatus(overrides),
      paths: { ...resolvePaths(overrides), rollback: rollbackPath(overrides), rollbackExists: rollbackExists(overrides) },
    });
    return;
  }

  if (pathname === `${ROUTE}/preview` && req.method === "POST") {
    try {
      const body = await readBody(req);
      const raw = body ? JSON.parse(body) : {};
      const config = normalizeConfig(raw.config ?? raw);
      const theme = raw.theme === "dark" || raw.theme === "light" ? raw.theme : config.theme.mode === "light" ? "light" : "dark";
      sendHtml(res, buildHtml(config, loadLogos(config), theme, { noShadow: true }));
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (pathname === `${ROUTE}/preview` && req.method === "GET") {
    sendHtml(res, previewHtml(url.searchParams.get("theme")));
    return;
  }

  if (pathname === `${ROUTE}/config` && req.method === "POST") {
    try {
      const body = await readBody(req);
      const next = normalizeConfig(body ? JSON.parse(body) : {});
      const saved = writeConfig(next);
      sendJson(res, 200, { ok: true, config: saved });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (pathname === `${ROUTE}/reset` && req.method === "POST") {
    const saved = resetConfig();
    sendJson(res, 200, { ok: true, config: saved, defaults: DEFAULTS });
    return;
  }

  if (pathname === `${ROUTE}/compat` && req.method === "GET") {
    // Read-only probe of the installed archive. The round-trip repack is the
    // slow part (it writes a 200 MB copy to the temp dir), so it can be turned
    // off with ?full=0 when the caller only wants the cheap checks.
    try {
      const full = url.searchParams.get("full") !== "0";
      const report = checkCompatibility(overrides, { full });
      if (full) recordCompat(report, true, overrides);
      sendJson(res, 200, { ok: true, report, compat: compatibilityStatus(overrides) });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (pathname === `${ROUTE}/deploy` && req.method === "POST") {
    try {
      const body = await readBody(req);
      const raw = body ? JSON.parse(body) : {};
      // Two-step confirmation on purpose: the settings page shows the rollback
      // path before this flag is sent, so a deployment is never one stray click.
      if (raw.confirmed !== true) {
        sendJson(res, 400, { ok: false, error: "confirmation required", needConfirm: true, rollback: rollbackPath(overrides) });
        return;
      }
      const config = normalizeConfig(raw.config ?? raw);
      // Re-check immediately before touching the archive: the host may have been
      // updated between opening this page and pressing the button.
      const pre = runFullCheck(overrides);
      if (!pre.ok) {
        sendJson(res, 409, { ok: false, error: "compatibility check failed", report: pre, compat: compatibilityStatus(overrides) });
        return;
      }
      writeConfig(config, overrides.dataDir);
      const result = await deploy(config, overrides);
      sendJson(res, result.ok ? 200 : 500, { ...result, report: pre, compat: compatibilityStatus(overrides) });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "not found" });
}

export function apply(ctx) {
  // The rollback script ships inside the plugin directory, but a fresh install
  // (or a deploy done from another session) may not have generated it yet, so
  // it is refreshed on every load. Installing the plugin therefore installs the
  // script too.
  try {
    ensureRollbackScript(resolvePaths());
  } catch (error) {
    console.log("[rsa] could not write the rollback script:", error && error.message ? error.message : String(error));
  }

  const runApply = (at) => {
    try {
      const r = applyPending({ at });
      if (r.applied) console.log(`[rsa] applied pending splash deployment (${at}, ${r.mode})`);
      else if (r.error) console.log(`[rsa] pending apply failed (${at}):`, r.error);
      else if (r.validated) console.log(`[rsa] pending splash deployment is armed and valid; it is swapped in when DSH exits (${at})`);
    } catch (error) {
      console.log(`[rsa] pending apply error (${at}):`, error && error.message ? error.message : String(error));
    }
  };

  // Startup: validate a pending file left behind by an interrupted session and
  // report it. Deliberately no swap here — this process is still reading from
  // app.asar, so replacing it mid-session would corrupt later reads.
  const timer = setTimeout(() => runApply("startup"), 2500);
  timer.unref?.();

  // First install, or a DSH update that swapped app.asar underneath us: run the
  // full check once by itself and remember it, so the panel can tell the user
  // whether the next deployment is safe without them having to ask.
  const compatTimer = setTimeout(() => {
    try {
      const status = compatibilityStatus();
      if (!status.needed) return;
      const report = runFullCheck();
      console.log(
        `[rsa] automatic compatibility check (${status.reason}, host ${report.hostVersion || "?"}): ${report.ok ? "passed" : "FAILED"}` +
          (report.ok ? "" : " — deep deployment is blocked until this is fixed"),
      );
    } catch (error) {
      console.log("[rsa] automatic compatibility check failed:", error && error.message ? error.message : String(error));
    }
  }, 5000);
  compatTimer.unref?.();

  // Quit-time flush: swap a freshly staged asar in before this process exits,
  // so the *next* launch already renders the new splash (one restart, not two).
  // Deliberately not tied to ctx disposal — plugins are torn down before the
  // process exit event, which would drop the listener exactly when it matters.
  const onExit = () => runApply("exit");
  process.once("exit", onExit);
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: ROUTE,
        handler: (req, res) => {
          handle(ctx, req, res).catch((error) => {
            try {
              sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            } catch {}
          });
        },
      }),
    "rsa: routes",
  );
}
