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

/**
 * Build an asar archive in memory from { "path/in/archive": string | Buffer }.
 * `paddingByte` mirrors what the packer fills the header's dead bytes with:
 * electron-builder uses NUL, older asar tooling used a space. The real host
 * archive is NUL-padded, which is the default here.
 */
export function buildAsar(files, { paddingByte = 0x00 } = {}) {
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

  // Mirror electron-builder's layout: the header JSON is padded to a 4-byte
  // boundary, head[4] carries padded+8, head[12] keeps the RAW JSON length.
  const raw = Buffer.from(JSON.stringify(tree), "utf8");
  const padLen = (4 - (raw.length % 4)) % 4;
  const jsonBuf = padLen ? Buffer.concat([raw, Buffer.alloc(padLen, paddingByte)]) : raw;
  const head = Buffer.alloc(HEADER_SIZE);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(jsonBuf.length + 8, 4);
  head.writeUInt32LE(jsonBuf.length + 4, 8);
  head.writeUInt32LE(raw.length, 12);

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
export function makeFixture(files = hostFiles(), options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-rsa-test-"));
  const resources = path.join(root, "resources");
  fs.mkdirSync(resources, { recursive: true });
  const asar = path.join(resources, "app.asar");
  fs.writeFileSync(asar, buildAsar(files, options));
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

/**
 * A host fixture whose header is guaranteed to carry padding bytes, the way the
 * real electron-builder archive does (0.2.2-rc.5 has 3). buildAsar only pads
 * when the JSON length lands off a 4-byte boundary, so grow a filler file until
 * it does.
 */
export function makePaddedFixture(paddingByte = 0x00) {
  const base = hostFiles();
  for (let n = 0; n < 32; n += 1) {
    const files = { ...base, "pad/filler.txt": "x".repeat(n) };
    const jsonLen = buildAsar(files, { paddingByte }).readUInt32LE(12);
    if (jsonLen % 4 !== 0) return makeFixture(files, { paddingByte });
  }
  throw new Error("could not build a padded header fixture");
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
