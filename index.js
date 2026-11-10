// Real startup animation (RSA) — host side.
// Serves the settings API under /rsa and performs deep deployment into app.asar.

import { readConfig, writeConfig, resetConfig, readState } from "./lib/store.mjs";
import { DEFAULTS, normalizeConfig } from "./lib/defaults.mjs";
import { buildHtml } from "./lib/render.mjs";
import { deploy, inspect, loadLogos, resolvePaths, applyPending } from "./lib/deploy.mjs";

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

async function handle(ctx, req, res) {
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
      inspect: inspect(),
      state: readState(),
      paths: resolvePaths(),
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

  if (pathname === `${ROUTE}/deploy` && req.method === "POST") {
    try {
      const body = await readBody(req);
      const config = body ? normalizeConfig(JSON.parse(body)) : readConfig();
      writeConfig(config);
      const result = await deploy(config);
      sendJson(res, result.ok ? 200 : 500, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "not found" });
}

export function apply(ctx) {
  const runApply = (why) => {
    try {
      const r = applyPending();
      if (r.applied) console.log(`[rsa] applied pending splash deployment (${why})`);
      else if (r.error) console.log(`[rsa] pending apply failed (${why}):`, r.error);
    } catch (error) {
      console.log(`[rsa] pending apply error (${why}):`, error && error.message ? error.message : String(error));
    }
  };

  // Startup fallback: a pending file left by an interrupted session is applied
  // a couple of seconds after boot. This is why a deployment used to need two
  // restarts — the swap happened after the splash had already been loaded.
  const timer = setTimeout(() => runApply("startup"), 2500);
  timer.unref?.();

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
