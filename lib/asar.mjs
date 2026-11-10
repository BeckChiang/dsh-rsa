// Minimal asar reader/repacker: enough to swap the splash module (and, on the
// first deploy, insert the main.js hook) without touching the rest of the tree.

import { createRequire } from "node:module";
import crypto from "node:crypto";

// Electron patches `node:fs` so that any path containing ".asar" is treated as a
// virtual archive path; even `fs.statSync('.../app.asar')` then fails with
// "ENOENT, not found in ...". `original-fs` bypasses that patch. Under plain
// Node (tests), fall back to the normal fs module.
const require = createRequire(import.meta.url);
let fs;
try {
  fs = require("original-fs");
} catch {
  fs = require("node:fs");
}

const HEADER_SIZE = 16;

/** Read the asar header tree. */
export function readAsar(asarPath) {
  const fd = fs.openSync(asarPath, "r");
  try {
    const head = Buffer.alloc(HEADER_SIZE);
    fs.readSync(fd, head, 0, HEADER_SIZE, 0);
    const jsonLen = head.readUInt32LE(12);
    const headerBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, headerBuf, 0, jsonLen, HEADER_SIZE);
    const tree = JSON.parse(headerBuf.toString("utf8"));
    return { fd, tree, jsonLen, dataOffset: HEADER_SIZE + jsonLen, size: fs.statSync(asarPath).size };
  } catch (error) {
    try {
      fs.closeSync(fd);
    } catch {}
    throw error;
  }
}

/** Collect every file node as { path, item }, in header traversal order. */
export function walkFiles(tree) {
  const out = [];
  const walk = (node, prefix) => {
    for (const [name, item] of Object.entries(node)) {
      const full = prefix ? `${prefix}/${name}` : name;
      if (item && item.files) walk(item.files, full);
      else if (item && item.offset !== undefined) out.push({ path: full, item });
    }
  };
  walk(tree.files ?? {}, "");
  return out;
}

/** Read one file's bytes from an open asar. */
export function readFileFromAsar(asar, filePath) {
  const { fd, dataOffset } = asar;
  const entry = lookupFile(asar.tree, filePath);
  if (!entry) throw new Error(`not found in asar: ${filePath}`);
  const abs = dataOffset + Number(entry.offset);
  const buf = Buffer.alloc(entry.size);
  fs.readSync(fd, buf, 0, entry.size, abs);
  return buf;
}

export function lookupFile(tree, filePath) {
  let node = { files: tree.files };
  for (const part of filePath.split("/")) {
    if (!node || !node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  return node;
}

function integrityFor(buf) {
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  return { algorithm: "SHA256", hash, blocks: [hash] };
}

/** Ensure the directory chain `parts` exists and return its leaf node. */
function ensureDir(tree, parts, filePath) {
  let dir = { files: tree.files };
  let walked = "";
  for (const part of parts) {
    walked = walked ? `${walked}/${part}` : part;
    if (!dir.files) throw new Error(`cannot add ${filePath}: ${walked} is a file in the asar`);
    if (!dir.files[part]) dir.files[part] = { files: {} };
    if (!dir.files[part].files) {
      throw new Error(`cannot add ${filePath}: ${walked} is a file in the asar`);
    }
    dir = dir.files[part];
  }
  return dir;
}

/**
 * Write a new asar where `replacements` (Map<path, Buffer>) are swapped in.
 * Paths that are not in the archive yet are appended as new files (creating
 * missing intermediate directories), so a clean official asar can gain the
 * splash module on the first deploy. Every other file keeps its bytes;
 * offsets after a replacement shift by the size delta. Unpacked entries are
 * left alone (their bytes live outside).
 *
 * Header offsets are pre-computed to match the writer below byte for byte:
 * gaps and trailing bytes of the old payload are copied verbatim, so appended
 * files start only after them.
 */
export function repackAsar(asar, outPath, replacements) {
  const { fd, tree, dataOffset, size } = asar;
  const files = walkFiles(tree);
  const known = new Set(files.map(({ path: filePath }) => filePath));
  const byOffset = files
    .filter(({ item }) => !item.unpacked && item.offset !== undefined)
    .sort((a, b) => Number(a.item.offset) - Number(b.item.offset));

  const additions = [...replacements.entries()]
    .filter(([filePath]) => !known.has(filePath))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const CHUNK = 8 * 1024 * 1024;
  const chunk = Buffer.alloc(CHUNK);

  try {
    // 1. Assign new offsets + sizes in the header, in payload order.
    let cursor = 0;
    let oldCursor = 0;
    const plan = [];
    for (const { path: filePath, item } of byOffset) {
      const oldOffset = Number(item.offset);
      const oldSize = item.size;
      if (oldOffset > oldCursor) cursor += oldOffset - oldCursor; // preserved gap
      item.offset = String(cursor);
      const replacement = replacements.get(filePath);
      if (replacement) {
        item.size = replacement.length;
        item.integrity = integrityFor(replacement);
        plan.push({ start: oldOffset, end: oldOffset + oldSize, replacement });
        cursor += replacement.length;
      } else {
        plan.push({ start: oldOffset, end: oldOffset + oldSize });
        cursor += oldSize;
      }
      oldCursor = oldOffset + oldSize;
    }
    const payloadLen = size - dataOffset;
    if (payloadLen > oldCursor) cursor += payloadLen - oldCursor; // preserved trailing bytes

    // 2. Append new paths after the original payload.
    for (const [filePath, buf] of additions) {
      const parts = filePath.split("/").filter(Boolean);
      const name = parts.pop();
      if (!name) throw new Error(`invalid asar path: ${filePath}`);
      const dir = ensureDir(tree, parts, filePath);
      if (dir.files[name]) throw new Error(`asar entry already exists: ${filePath}`);
      dir.files[name] = { size: buf.length, offset: String(cursor), integrity: integrityFor(buf) };
      cursor += buf.length;
    }

    // 3. Header bytes (needed before the payload can be placed at its real offset).
    const newJson = JSON.stringify(tree);
    const padded = newJson + " ".repeat((4 - (newJson.length % 4)) % 4);
    const jsonBuf = Buffer.from(padded, "utf8");
    const head = Buffer.alloc(HEADER_SIZE);
    head.writeUInt32LE(4, 0);
    head.writeUInt32LE(jsonBuf.length + 8, 4);
    head.writeUInt32LE(jsonBuf.length + 4, 8);
    head.writeUInt32LE(jsonBuf.length, 12);

    // 4. Write header then payload in one pass.
    const out = fs.openSync(outPath, "w");
    const copyRange = (start, end) => {
      let pos = start;
      while (pos < end) {
        const len = Math.min(CHUNK, end - pos);
        fs.readSync(fd, chunk, 0, len, pos);
        fs.writeSync(out, chunk, 0, len);
        pos += len;
      }
    };
    try {
      fs.writeSync(out, head);
      fs.writeSync(out, jsonBuf);
      let readCursor = 0;
      for (const step of plan) {
        if (step.start > readCursor) {
          copyRange(dataOffset + readCursor, dataOffset + step.start);
        }
        if (step.replacement) fs.writeSync(out, step.replacement);
        else copyRange(dataOffset + step.start, dataOffset + step.end);
        readCursor = step.end;
      }
      if (readCursor < payloadLen) copyRange(dataOffset + readCursor, size);
      for (const [, buf] of additions) fs.writeSync(out, buf);
    } finally {
      fs.closeSync(out);
    }

    const written = fs.statSync(outPath).size;
    const expected = HEADER_SIZE + jsonBuf.length + cursor;
    if (written !== expected) {
      throw new Error(`repacked asar size mismatch: wrote ${written} bytes, header expects ${expected}`);
    }
    return { jsonLen: jsonBuf.length, size: written };
  } finally {
    // nothing else to close: `out` is closed in the inner finally
  }
}
