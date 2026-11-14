// Compatibility check.
//
// Deep deployment rewrites the host's app.asar, and a wrong rewrite means the
// desktop app does not start at all — which the plugin cannot repair from
// inside, because it only runs when the app runs. So before anything is
// written, the installed archive is inspected with read-only probes that prove
// our understanding of its layout. If a probe fails, deployment is refused.
//
// The checks are ordered cheapest-first and every one of them is independent of
// our own writer, except `roundtrip`, which is the strongest one and therefore
// only runs on the explicit "check compatibility" action (it rewrites the whole
// 200 MB archive to a temp file).

import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readAsar, readFileFromAsar, repackAsar, verifyAsar } from "./asar.mjs";
import { hasHook, injectHook } from "./hook.mjs";

const require = createRequire(import.meta.url);
let fs;
try {
  fs = require("original-fs");
} catch {
  fs = require("node:fs");
}

/**
 * Host versions this plugin was verified against. A different version does not
 * fail the check — the archive probes still prove the layout — but it is
 * reported so an upgrade is a visible event instead of a silent breakage.
 */
export const TESTED_HOST_VERSIONS = ["0.2.2-rc.3"];

const DEFAULT_MAIN = "lib/main.js";

function shortPath(p) {
  return p;
}

function readHostMeta(asar) {
  let pkg = null;
  try {
    pkg = JSON.parse(readFileFromAsar(asar, "package.json").toString("utf8"));
  } catch {}
  return pkg;
}

/** Header fields: the numbers Electron itself uses to find the payload. */
export function readHeaderFields(asarPath) {
  let fd;
  try {
    fd = fs.openSync(asarPath, "r");
    const head = Buffer.alloc(16);
    const read = fs.readSync(fd, head, 0, 16, 0);
    if (read !== 16) throw new Error(`app.asar is too small (${read} header bytes)`);
    return {
      size: fs.fstatSync(fd).size,
      headerSize: head.readUInt32LE(4) - 8,
      headerSizeField: head.readUInt32LE(4),
      stringField: head.readUInt32LE(8),
      rawJsonLength: head.readUInt32LE(12),
    };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

/**
 * Run every compatibility probe against the installed archive.
 *
 * `overrides.resources` / `overrides.exe` point the check at a fixture instead
 * of the running installation. `options.full` enables the round-trip repack,
 * `options.verify` enables the full integrity pass (both default to true).
 */
export function checkCompatibility(overrides = {}, options = {}) {
  const full = options.full !== false;
  const verify = options.verify !== false;
  const resources = overrides.resources ?? process.resourcesPath;
  const asarPath = path.join(resources, "app.asar");
  const exe = overrides.exe ?? process.execPath;
  const checks = [];
  const report = {
    ok: false,
    asarPath: shortPath(asarPath),
    exe: shortPath(exe),
    hostVersion: "",
    hostMain: "",
    testedVersions: [...TESTED_HOST_VERSIONS],
    checkedAt: new Date().toISOString(),
    checks,
    error: null,
  };

  const add = (id, ok, detail, warn = false) => {
    checks.push({ id, ok: Boolean(ok), warn: Boolean(warn), detail: String(detail ?? "") });
    return Boolean(ok);
  };

  if (!fs.existsSync(asarPath)) {
    add("file", false, `app.asar not found: ${asarPath}`);
    report.ok = false;
    report.error = `app.asar not found: ${asarPath}`;
    return report;
  }
  add("file", true, `${shortPath(asarPath)} · ${(fs.statSync(asarPath).size / 1024 / 1024).toFixed(1)} MB`);

  let asar;
  try {
    asar = readAsar(asarPath);
    report.hostVersion = String(readHostMeta(asar)?.version ?? "");

    // 1. Header self-consistency. This is the exact field the 0.2.4 bug
    // misread: the raw JSON length is not the header size when Electron pads
    // the JSON to a 4-byte boundary.
    const head = readHeaderFields(asarPath);
    const padding = Math.max(0, head.headerSize - head.rawJsonLength);
    const headerOk =
      head.headerSize >= head.rawJsonLength &&
      head.headerSize === asar.headerSize &&
      (16 + head.headerSize) % 4 === 0 &&
      16 + head.headerSize <= head.size;
    add(
      "header",
      headerOk,
      `header ${head.headerSize} B, json ${head.rawJsonLength} B, padding ${padding} B, payload starts at ${16 + head.headerSize}`,
    );
    if (!headerOk) throw new Error("archive header is not self-consistent");

    // 2. File layout: every file must live inside the archive, contiguously
    // after the header, never overlapping its neighbour.
    let extent = 0;
    let files = 0;
    let gaps = 0;
    const walk = (node) => {
      for (const entry of Object.values(node.files ?? {})) {
        if (entry.unpacked) continue;
        if (entry.files) {
          walk(entry);
          continue;
        }
        if (entry.size === undefined) continue;
        files += 1;
        const start = asar.dataOffset + Number(entry.offset);
        const end = start + Number(entry.size);
        if (Number(entry.offset) < 0 || start < asar.dataOffset || end > asar.size) {
          throw new Error(`entry at offset ${start} is outside the archive (${start}..${end} of ${asar.size})`);
        }
        // Gaps between entries are legal in asar (electron-builder leaves them
        // for unpacked payloads), so they are only reported, never fatal.
        if (start > extent && extent !== 0) gaps += start - extent;
        extent = Math.max(extent, end);
      }
    };
    let walkError = null;
    try {
      walk(asar.tree);
    } catch (error) {
      // Keep going: the integrity pass below reports the same damage per file,
      // which is far more useful in the UI than a single thrown message.
      walkError = error;
    }
    const layoutOk = !walkError && extent > 0 && extent <= asar.size && asar.size - extent <= 4;
    add("layout", layoutOk, walkError ? walkError.message : `${files} files, payload ends at ${extent} of ${asar.size}${gaps ? `, ${gaps} B of alignment gaps` : ""}`);

    // 3. Full integrity pass: the header carries one SHA256 per file, and a
    // repacker that misplaces the payload cannot satisfy them.
    if (verify) {
      const { checked, bad } = verifyAsar(asar);
      add(
        "integrity",
        bad.length === 0,
        bad.length === 0 ? `${checked} hashed files match` : `${bad.length} of ${checked} files do not match: ${bad.slice(0, 5).join(", ")}`,
      );
    }

    // 4. Host entry: our hook has to land in a file that is really the entry.
    const pkg = readHostMeta(asar);
    const mainEntry = String(pkg?.main || DEFAULT_MAIN).trim().replace(/^\.\//, "").replace(/\\/g, "/") || DEFAULT_MAIN;
    report.hostMain = mainEntry;
    let mainSrc = "";
    try {
      mainSrc = readFileFromAsar(asar, mainEntry).toString("utf8");
    } catch {}
    const looksLikeJs = /^\s*(\/\/|\/\*|"use strict"|'use strict'|import\s|export\s|const\s|let\s|var\s|function\s|#!)/.test(mainSrc);
    const patched = injectHook(mainSrc, "./splash.cjs");
    const entryOk = Boolean(pkg?.name) && Boolean(mainSrc) && looksLikeJs && hasHook(patched.source);
    add(
      "entry",
      entryOk,
      entryOk
        ? `${mainEntry} (${mainSrc.length} B) is the host entry; hook ${hasHook(mainSrc) ? "already present" : "can be injected"}`
        : `package.json/main does not look like a host entry (name=${pkg?.name ?? "?"}, entry=${mainEntry}, ${mainSrc.length} B)`,
    );

    // 5. Round trip: rewrite the archive unchanged and require byte equality.
    // Nothing else proves our writer agrees with this host build.
    if (full) {
      const tmp = path.join(os.tmpdir(), `rsa-compat-${process.pid}-${Date.now()}.asar`);
      try {
        const before = fs.statSync(asarPath).size;
        const out = repackAsar(asar, tmp, new Map());
        const after = fs.statSync(tmp).size;
        const digest = (p) => createHashOf(p);
        const same = before === after && digest(asarPath) === digest(tmp);
        add("roundtrip", same, same ? `re-packed archive is byte-identical (${out.size} B)` : `re-packed archive differs (${before} B -> ${after} B)`);
      } finally {
        try {
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch {}
      }
    }

    // 6. Version against the tested list. Informational: the probes above are
    // what actually decide whether writing is safe.
    const known = TESTED_HOST_VERSIONS.includes(report.hostVersion);
    add(
      "version",
      known,
      known ? `host ${report.hostVersion} is a tested version` : `host ${report.hostVersion || "unknown"} is not in the tested list (${TESTED_HOST_VERSIONS.join(", ")})`,
      !known,
    );
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    if (!checks.some((c) => !c.ok)) add("error", false, report.error);
  } finally {
    if (asar) {
      try {
        fs.closeSync(asar.fd);
      } catch {}
    }
  }

  report.ok = checks.every((c) => c.ok || c.warn);
  return report;
}

function createHashOf(file) {
  const hash = createHash("sha256");
  const buf = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(file, "r");
  try {
    let pos = 0;
    for (;;) {
      const read = fs.readSync(fd, buf, 0, buf.length, pos);
      if (!read) break;
      hash.update(buf.subarray(0, read));
      pos += read;
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

// --- compatibility freshness -------------------------------------------------

// Reads just enough of the installed archive to name the host build: the header
// plus package.json. Used on every settings-page load, so it must stay cheap
// (no hashing, no repack).
export function hostVersionAt(asarPath) {
  try {
    const asar = readAsar(asarPath);
    const pkg = JSON.parse(readFileFromAsar(asar, "package.json").toString("utf8"));
    return { ok: true, version: pkg.version || null, asarSize: asar.size };
  } catch (error) {
    return { ok: false, version: null, error: error instanceof Error ? error.message : String(error) };
  }
}

// Decides whether the banner has to appear: a host update swaps app.asar, so a
// check recorded against an older build says nothing about the current one.
// `first-run` is the "just installed, never checked" case.
export function compatStatus(asarPath, state = {}) {
  const host = hostVersionAt(asarPath);
  const last = {
    at: state.lastCompatAt || null,
    hostVersion: state.lastCompatHostVersion || null,
    ok: typeof state.lastCompatOk === "boolean" ? state.lastCompatOk : null,
    full: state.lastCompatFull === true,
    error: state.lastCompatError || null,
  };
  let needed = false;
  let reason = null;
  if (!host.ok) {
    needed = true;
    reason = "no-host";
  } else if (!last.at) {
    needed = true;
    reason = "first-run";
  } else if (last.hostVersion !== host.version) {
    needed = true;
    reason = "host-updated";
  } else if (last.ok === false) {
    needed = true;
    reason = "last-failed";
  }
  return {
    needed,
    reason,
    hostVersion: host.version,
    asarSize: host.ok ? host.asarSize : null,
    hostError: host.ok ? null : host.error,
    last,
  };
}
