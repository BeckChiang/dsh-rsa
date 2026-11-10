// Fixture helpers for the deploy/asar tests: build tiny but structurally valid
// asar archives (same header layout as lib/asar.mjs writes) and throw-away
// host installations under the OS temp directory.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readAsar, readFileFromAsar, walkFiles } from "../lib/asar.mjs";

const HEADER_SIZE = 16;

function integrity(buf) {
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  return { algorithm: "SHA256", hash, blocks: [hash] };
}

/** Build an asar archive in memory from { "path/in/archive": string | Buffer }. */
export function buildAsar(files) {
  const tree = { files: {} };
  const chunks = [];
  let offset = 0;

  for (const filePath of Object.keys(files)) {
    const buf = Buffer.isBuffer(files[filePath]) ? files[filePath] : Buffer.from(files[filePath], "utf8");
    const parts = filePath.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error(`invalid fixture path: ${filePath}`);
    let dir = tree;
    for (const part of parts) {
      if (!dir.files[part]) dir.files[part] = { files: {} };
      dir = dir.files[part];
    }
    dir.files[name] = { size: buf.length, offset: String(offset), integrity: integrity(buf) };
    chunks.push(buf);
    offset += buf.length;
  }

  const json = JSON.stringify(tree);
  const padded = json + " ".repeat((4 - (json.length % 4)) % 4);
  const jsonBuf = Buffer.from(padded, "utf8");
  const head = Buffer.alloc(HEADER_SIZE);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(jsonBuf.length + 8, 4);
  head.writeUInt32LE(jsonBuf.length + 4, 8);
  head.writeUInt32LE(jsonBuf.length, 12);

  return Buffer.concat([head, jsonBuf, ...chunks]);
}

/** A minimal official-looking host archive (no splash hook, no splash module). */
export function hostFiles(overrides = {}) {
  return {
    "package.json": JSON.stringify({ name: "@deepseek-ai/dsh-desktop", version: "9.9.9", main: "lib/main.js" }),
    "lib/main.js": '"use strict";\nconsole.log("host main");\n',
    "lib/other.js": "module.exports = 42;\n",
    ...overrides,
  };
}

/**
 * Create a throw-away installation: `<tmp>/resources/app.asar` plus a data dir
 * the deploy can write its state into.
 */
export function makeFixture(files = hostFiles()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-rsa-test-"));
  const resources = path.join(root, "resources");
  fs.mkdirSync(resources, { recursive: true });
  const asar = path.join(resources, "app.asar");
  fs.writeFileSync(asar, buildAsar(files));
  return {
    root,
    resources,
    asar,
    dataDir: path.join(root, "data"),
    exe: path.join(root, "DeepSeek Harness.exe"),
    pending: path.join(resources, "app.asar.rsa-new"),
    backup: path.join(resources, "app.asar.rsa-backup"),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Read one file out of an asar on disk, closing the archive afterwards. */
export function readEntry(asarPath, filePath) {
  const asar = readAsar(asarPath);
  try {
    return readFileFromAsar(asar, filePath);
  } finally {
    fs.closeSync(asar.fd);
  }
}

/** Every file path in an asar on disk. */
export function listEntries(asarPath) {
  const asar = readAsar(asarPath);
  try {
    return walkFiles(asar.tree).map(({ path: filePath }) => filePath);
  } finally {
    fs.closeSync(asar.fd);
  }
}
