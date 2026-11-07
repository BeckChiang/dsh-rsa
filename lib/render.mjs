// Renders the RSA splash HTML and the splash.cjs module that the patched
// Electron main process imports at startup.

const DEFAULTS = {
  window: { width: 520, height: 308, radius: 26 },
  theme: { lightAlpha: 0.86, darkAlpha: 0.80 },
};

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function perimeter(w, h, r) {
  const innerW = w - 2.4 - (r - 1) * 2;
  const innerH = h - 2.4 - (r - 1) * 2;
  return 2 * (innerW + innerH) + 2 * Math.PI * (r - 1);
}

function creditPosition(cfg) {
  const { position, offsetX, offsetY } = cfg.credit;
  const vertical = position.startsWith("top") ? `top:${offsetY}px` : `bottom:${offsetY}px`;
  const horizontal = position.endsWith("right") ? `right:${offsetX}px` : `left:${offsetX}px`;
  return `${vertical};${horizontal}`;
}

function taglineMarkup(cfg) {
  const { text, effect } = cfg.tagline;
  if (effect === "none") return `<div class="tagline">${esc(text)}</div>`;
  const letters = Array.from(text)
    .map((ch, i) => `<span class="w" style="--i:${i}">${ch === " " ? "&nbsp;" : esc(ch)}</span>`)
    .join("");
  return `<div class="tagline">${letters}</div>`;
}

function themeBlock(name, cardAlpha, isDark, cfg) {
  const lines = [
    `body[data-theme="${name}"] {`,
    `  --card: rgba(${isDark ? "30,33,42" : "255,255,255"},${cardAlpha});`,
    `  --border: rgba(${isDark ? "255,255,255,0.10" : "15,23,42,0.10"});`,
    `  --shadow: rgba(${isDark ? "0,0,0,0.55" : "15,23,42,0.16"});`,
    `  --text: ${isDark ? "#a0a6b0" : "#6b7280"};`,
    `  --credit: ${isDark ? "#788293" : "#9ca3af"};`,
    `  --ring-track: rgba(${isDark ? "255,255,255,0.14" : "17,24,39,0.14"});`,
    `  --ring-bar: ${isDark ? "#e5e7eb" : "#111827"};`,
    `  --blob1: ${isDark ? "rgba(37,99,235" : "rgba(96,165,250"},${cfg.blobs.alphaA});`,
    `  --blob2: ${isDark ? "rgba(124,58,237" : "rgba(196,181,253"},${cfg.blobs.alphaB});`,
    `}`,
  ];
  return lines.join("\n");
}

function ringMarkup(cfg) {
  if (!cfg.ring.enabled) return "";
  const { width: W, height: H, radius: R } = cfg.window;
  const L = perimeter(W, H, R);
  const rx = Math.max(0, R - 1);
  const rectAttrs = `x="1.2" y="1.2" width="${(W - 2.4).toFixed(1)}" height="${(H - 2.4).toFixed(1)}" rx="${rx.toFixed(1)}"`;
  const style = cfg.ring.style;

  if (style === "breathe") {
    return `<svg class="ring" viewBox="0 0 ${W} ${H}" fill="none">
    <rect class="ring-track" ${rectAttrs} stroke-width="1.2"/>
    <rect class="ring-breathe" ${rectAttrs} stroke-width="${cfg.ring.width}" stroke-linecap="round"/>
  </svg>`;
  }

  if (style === "dots") {
    const step = Math.max(18, L / 14);
    return `<svg class="ring" viewBox="0 0 ${W} ${H}" fill="none">
    <rect class="ring-track" ${rectAttrs} stroke-width="1.2"/>
    <rect class="ring-run" ${rectAttrs} stroke-width="${cfg.ring.width}" stroke-linecap="round"
      stroke-dasharray="2.5 ${(step - 2.5).toFixed(1)}"/>
  </svg>`;
  }

  const barLen = Math.min(cfg.ring.length, L - 2);
  const tailParts = cfg.ring.tail
    ? [
        `<rect id="tail3" class="ring-tail" ${rectAttrs} stroke-width="${(cfg.ring.width * 0.75).toFixed(2)}" stroke-dasharray="24 ${(L - 24).toFixed(1)}" opacity="0.18" stroke-linecap="round"/>`,
        `<rect id="tail2" class="ring-tail" ${rectAttrs} stroke-width="${(cfg.ring.width * 0.85).toFixed(2)}" stroke-dasharray="24 ${(L - 24).toFixed(1)}" opacity="0.34" stroke-linecap="round"/>`,
        `<rect id="tail1" class="ring-tail" ${rectAttrs} stroke-width="${(cfg.ring.width * 0.95).toFixed(2)}" stroke-dasharray="24 ${(L - 24).toFixed(1)}" opacity="0.52" stroke-linecap="round"/>`,
      ].join("\n      ")
    : "";

  return `<svg class="ring" viewBox="0 0 ${W} ${H}" fill="none">
      <rect class="ring-track" ${rectAttrs} stroke-width="1.2"/>
      ${tailParts}
      <rect id="ringRun" class="ring-run" ${rectAttrs} stroke-width="${cfg.ring.width}" stroke-linecap="round"
        stroke-dasharray="${barLen.toFixed(1)} ${(L - barLen).toFixed(1)}"/>
    </svg>`;
}

function ringScript(cfg) {
  if (!cfg.ring.enabled || cfg.ring.style !== "band") return "";
  const { width: W, height: H, radius: R } = cfg.window;
  const L = perimeter(W, H, R);
  const base = L / Math.max(0.2, cfg.ring.period);
  const tailLags = [26, 52, 78];
  return `
  const run = document.getElementById("ringRun");
  const tails = [
    { el: document.getElementById("tail1"), lag: ${tailLags[0]} },
    { el: document.getElementById("tail2"), lag: ${tailLags[1]} },
    { el: document.getElementById("tail3"), lag: ${tailLags[2]} }
  ];
  const L = ${L.toFixed(2)};
  const base = ${base.toFixed(3)};
  let ang = 0;
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const p = ang / L;
    const speed = 1 + 0.5 * Math.sin(2 * Math.PI * (p - 0.12));
    ang = (ang + base * speed * dt) % L;
    if (ang < 0) ang += L;
    let off = -ang;
    while (off > 0) off -= L;
    run.style.strokeDashoffset = off.toFixed(1);
    for (const t of tails) {
      if (!t.el) continue;
      let o = -(ang - t.lag);
      while (o > 0) o -= L;
      t.el.style.strokeDashoffset = o.toFixed(1);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);`;
}

/** Build the splash page HTML for one theme. */
export function buildHtml(cfg, logos, theme, options = {}) {
  const { width: W, height: H, radius: R } = cfg.window;
  const isDark = theme === "dark";
  const cardAlpha = isDark ? cfg.theme.darkAlpha : cfg.theme.lightAlpha;
  const logoSrc = isDark ? logos.dark : logos.light;
  const tagline = cfg.tagline;
  const taglineCss =
    tagline.effect === "rise"
      ? `
  .tagline .w { display: inline-block; opacity: 0; animation: rise ${tagline.period}s ease-in-out infinite;
    animation-delay: calc(var(--i) * ${tagline.delay}ms); }`
      : tagline.effect === "fade"
        ? `
  .tagline { opacity: 0; animation: fadeLine ${tagline.period}s ease-in-out infinite; }
  @keyframes fadeLine { 0%, 100% { opacity: 0; } 12%, 78% { opacity: 1; } }`
        : "";

  const blobSpeed = cfg.blobs.enabled && cfg.blobs.motion === "float" ? cfg.blobs.speed : 0;
  const blobCss =
    blobSpeed > 0
      ? `
  .blob { position: absolute; border-radius: 50%; filter: blur(2px); will-change: transform, opacity; }
  .blob.b1 { width: ${(W * 0.54).toFixed(0)}px; height: ${(H * 0.77).toFixed(0)}px; left: ${(-W * 0.115).toFixed(0)}px; top: ${(-H * 0.16).toFixed(0)}px; background: var(--blob1);
    animation: drift1 ${(16 / blobSpeed).toFixed(2)}s ease-in-out infinite; }
  .blob.b2 { width: ${(W * 0.52).toFixed(0)}px; height: ${(H * 0.75).toFixed(0)}px; left: ${(W * 0.77).toFixed(0)}px; top: ${(H * 0.68).toFixed(0)}px; background: var(--blob2);
    animation: drift2 ${(20 / blobSpeed).toFixed(2)}s ease-in-out infinite; }
  @keyframes drift1 {
    0%, 100% { transform: translate(0, 0) scale(1); opacity: .72; }
    35% { transform: translate(${(W * 0.185).toFixed(0)}px, ${(H * 0.208).toFixed(0)}px) scale(1.28); opacity: .92; }
    70% { transform: translate(${(-W * 0.046).toFixed(0)}px, ${(H * 0.357).toFixed(0)}px) scale(1.10); opacity: .80; }
  }
  @keyframes drift2 {
    0%, 100% { transform: translate(0, 0) scale(1); opacity: .70; }
    40% { transform: translate(${(-W * 0.212).toFixed(0)}px, ${(-H * 0.227).toFixed(0)}px) scale(1.30); opacity: .90; }
    72% { transform: translate(${(W * 0.077).toFixed(0)}px, ${(-H * 0.097).toFixed(0)}px) scale(1.06); opacity: .78; }
  }`
      : "";

  const credit = cfg.credit.visible
    ? `<div class="credit">${esc(cfg.credit.text)}</div>`
    : "";

  const ringExtra =
    cfg.ring.style === "breathe"
      ? `
  .ring-breathe { stroke: var(--ring-bar); fill: none; opacity: .55; animation: ringBreathe ${cfg.ring.period}s ease-in-out infinite; }
  @keyframes ringBreathe { 0%, 100% { opacity: .25; } 50% { opacity: .85; } }`
      : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; color-scheme: light dark; overflow: hidden;
    font-family: "${esc(tagline.family)}", "Microsoft YaHei UI", sans-serif; -webkit-user-select: none; user-select: none; }
  ${themeBlock("light", cardAlpha, false, cfg)}
  ${themeBlock("dark", cardAlpha, true, cfg)}
  .stage { position: relative; width: ${W}px; height: ${H}px; }
  .card {
    position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px;
    border-radius: ${R}px; background: var(--card);
    border: 1px solid var(--border);
    box-shadow: ${options.noShadow ? "none" : "0 20px 60px var(--shadow)"};
    overflow: hidden;
    display: flex; flex-direction: column; align-items: center;
    animation: fadeIn .45s ease-out both;
  }
  @keyframes fadeIn { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: scale(1); } }
  .logo { position: absolute; top: ${cfg.logo.top}px; left: 50%; transform: translateX(-50%); width: ${cfg.logo.width}px; }
  .logo img { width: ${cfg.logo.width}px; height: auto; display: block; max-width: 100%; }
  .tagline { position: absolute; top: ${tagline.top}px; left: 0; right: 0; text-align: center;
    font-size: ${tagline.size}px; font-weight: ${tagline.weight}; letter-spacing: ${tagline.letterSpacing}px;
    color: var(--text);${tagline.italic ? " font-style: italic;" : ""} }
  @keyframes rise {
    0% { opacity: 0; transform: translateY(7px); }
    10% { opacity: 1; transform: translateY(0); }
    76% { opacity: 1; transform: translateY(0); }
    90% { opacity: 0; transform: translateY(-4px); }
    100% { opacity: 0; transform: translateY(7px); }
  }${taglineCss}${blobCss}
  .credit { position: absolute; ${creditPosition(cfg)}; font-size: ${cfg.credit.size}px; color: var(--credit); letter-spacing: .2px; }
  .ring { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: visible; }
  .ring-track { stroke: var(--ring-track); fill: none; }
  .ring-run { stroke: var(--ring-bar); fill: none; }
  .ring-tail { stroke: var(--ring-bar); fill: none; }${ringExtra}
</style>
</head>
<body data-theme="${theme}">
  <div class="stage">
    <div class="card">
      ${cfg.blobs.enabled ? '<div class="blob b1"></div><div class="blob b2"></div>' : ""}
      <div class="logo"><img src="${logoSrc}" alt=""></div>
      ${taglineMarkup(cfg)}
      ${credit}
    </div>
    ${ringMarkup(cfg)}
  </div>
${ringScript(cfg) ? `<script>${ringScript(cfg)}
</script>` : ""}
</body>
</html>`;
}

/** Build the CJS module that main.js imports and calls show() on. */
export function renderSplash(cfg, logos) {
  const { width, height, radius } = cfg.window;
  const lightHtml = buildHtml(cfg, logos, "light");
  const darkHtml = buildHtml(cfg, logos, "dark");
  const lightB64 = JSON.stringify(lightHtml);
  const darkB64 = JSON.stringify(darkHtml);

  return `"use strict";

const { BrowserWindow, app, nativeTheme } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const LOG = path.join(os.tmpdir(), "dsh-splash.log");
function log(message) {
  try {
    fs.appendFileSync(LOG, new Date().toISOString() + " " + message + "\\n");
  } catch {}
}

const HTML_LIGHT = ${lightB64};
const HTML_DARK = ${darkB64};

const MIN_VISIBLE_MS = 1500;
const MAX_MS = 90000;
const SHOW_FALLBACK_MS = 2500;

let win = null;
let timer = null;
let shownAt = 0;
let closed = false;

function isDark() {
  try {
    return ${cfg.theme.mode === "dark" ? "true" : cfg.theme.mode === "light" ? "false" : "nativeTheme.shouldUseDarkColors === true"};
  } catch {
    return true;
  }
}

function finish(reason) {
  if (closed) return;
  closed = true;
  log("close requested: " + reason);
  const elapsed = Date.now() - shownAt;
  const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
  setTimeout(() => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (win && !win.isDestroyed()) {
      try { win.close(); } catch (error) { log("close error: " + error); }
    }
    log("closed");
  }, wait);
}

function onWindowCreated(_event, created) {
  if (created === win) return;
  log("main window created");
  created.once("show", () => finish("main window show"));
}

function show() {
  log("show called, platform=" + process.platform);
  if (win || process.platform !== "win32") return;
  try {
    const dark = isDark();
    win = new BrowserWindow({
      width: ${width},
      height: ${height},
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      roundedCorners: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    log("window constructed, dark=" + dark);
    try {
      if (typeof win.setShape === "function") {
        const W = ${width}, H = ${height}, R = ${radius};
        const rects = [];
        for (let y = 0; y < H; y++) {
          let inset = 0;
          if (y < R) { const dy = R - y; inset = Math.round(R - Math.sqrt(R * R - dy * dy)); }
          else if (y > H - R - 1) { const dy = y - (H - R - 1); inset = Math.round(R - Math.sqrt(R * R - dy * dy)); }
          rects.push({ x: inset, y, width: W - inset * 2, height: 1 });
        }
        win.setShape(rects);
        log("setShape applied " + rects.length);
      } else {
        log("setShape unavailable");
      }
    } catch (shapeError) {
      log("setShape failed: " + shapeError);
    }
    const page = dark ? HTML_DARK : HTML_LIGHT;
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page));
    win.once("ready-to-show", () => {
      if (!win || win.isDestroyed()) return;
      win.show();
      shownAt = Date.now();
      log("shown (ready-to-show)");
    });
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      if (!win.isVisible()) {
        win.show();
        shownAt = Date.now();
        log("shown (fallback)");
      }
    }, SHOW_FALLBACK_MS);
    win.setMenuBarVisibility(false);
    if (typeof win.setIgnoreMouseEvents === "function") win.setIgnoreMouseEvents(true);
    win.webContents.on("render-process-gone", () => finish("render gone"));
    app.on("browser-window-created", onWindowCreated);
    timer = setTimeout(() => finish("timeout"), MAX_MS);
    timer.unref?.();
    log("listeners ready");
  } catch (error) {
    log("construct failed: " + error);
    if (win && !win.isDestroyed()) { try { win.destroy(); } catch {} }
    win = null;
  }
}

module.exports = { show, destroy: () => finish("destroy") };
`;
}
