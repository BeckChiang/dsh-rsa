// Real startup animation (RSA) — host side.
// Serves the settings API under /rsa and performs deep deployment into app.asar.

import { readConfig, writeConfig, resetConfig, readState } from "./lib/store.mjs";
import { DEFAULTS, normalizeConfig } from "./lib/defaults.mjs";
import { buildHtml } from "./lib/render.mjs";
import { deploy, inspect, loadLogos, resolvePaths, applyPending } from "./lib/deploy.mjs";

export const name = "@local/rsa";
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

async function handle(ctx, req, res) {
  const url = parseUrl(req);
  const pathname = url.pathname;

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
  // Apply a previously prepared deployment on startup. Never restarts the app;
  // if the asar is locked we keep the pending file and retry next launch.
  const timer = setTimeout(() => {
    try {
      const r = applyPending();
      if (r.applied) console.log("[rsa] applied pending splash deployment");
      else if (r.error) console.log("[rsa] pending apply failed:", r.error);
    } catch (error) {
      console.log("[rsa] pending apply error:", error && error.message ? error.message : String(error));
    }
  }, 2500);
  timer.unref?.();
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
