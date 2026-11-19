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

/**
 * Read the asar header tree.
 *
 * electron-builder pads the header JSON so the payload starts on a 4-byte
 * boundary, so `head[12]` (the raw JSON length) is usually NOT the distance
 * from the end of the 16-byte preamble to the payload. Electron itself reads
 * `head[4] - 8` as the padded header size; using `head[12]` instead shifts
 * every byte of every file by up to 3 bytes and produces an archive that
 * parses as garbage. Prefer `head[4]`, fall back to the aligned `head[12]`.
 */
export function readAsar(asarPath) {
  const fd = fs.openSync(asarPath, "r");
  try {
    const head = Buffer.alloc(HEADER_SIZE);
    fs.readSync(fd, head, 0, HEADER_SIZE, 0);
    const jsonLen = head.readUInt32LE(12);
    const declared = head.readUInt32LE(4);
    const headerSize =
      declared >= 8 && declared - 8 >= jsonLen ? declared - 8 : jsonLen + ((4 - (jsonLen % 4)) % 4);
    if (headerSize < jsonLen) throw new Error(`asar header is shorter than its JSON: ${headerSize} < ${jsonLen}`);
    const headerBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, headerBuf, 0, jsonLen, HEADER_SIZE);
    const tree = JSON.parse(headerBuf.toString("utf8"));
    // The bytes between the JSON and the payload are dead space Electron never
    // reads, but their *value* is part of the file. electron-builder pads with
    // NUL, the older asar tool padded with spaces; either way the byte is copied
    // back verbatim so a re-pack of an unchanged archive stays byte-identical.
    const paddingLen = Math.max(0, headerSize - jsonLen);
    const padding = Buffer.alloc(paddingLen);
    if (paddingLen) fs.readSync(fd, padding, 0, paddingLen, HEADER_SIZE + jsonLen);
    return {
      fd,
      tree,
      jsonLen,
      headerSize,
      padding,
      paddingByte: paddingLen ? padding[0] : null,
      dataOffset: HEADER_SIZE + headerSize,
      size: fs.statSync(asarPath).size,
    };
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

// asar integrity blocks are 4 MiB each; Electron hashes every block separately
// and compares the array. A single whole-file block is only correct for files
// under 4 MiB, so build the array the same way the packer does.
const ASAR_BLOCK_SIZE = 4 * 1024 * 1024;

function integrityFor(buf) {
  const blocks = [];
  for (let pos = 0; pos < buf.length; pos += ASAR_BLOCK_SIZE) {
    const slice = buf.subarray(pos, Math.min(pos + ASAR_BLOCK_SIZE, buf.length));
    blocks.push(crypto.createHash("sha256").update(slice).digest("hex"));
  }
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  return { algorithm: "SHA256", hash, blocks };
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
 * Verify every file that carries a whole-file SHA256 integrity hash against the
 * bytes actually stored in the archive. Returns the list of mismatching paths.
 * This is the guard that a header/offset bug cannot slip past: a repacker that
 * shifts the payload by a few bytes still writes a self-consistent header, so
 * only hashing the bytes catches it.
 */
export function verifyAsar(asar, { limit = Infinity } = {}) {
  const bad = [];
  let checked = 0;
  for (const { path: filePath, item } of walkFiles(asar.tree)) {
    if (item.unpacked) continue;
    const expected = item.integrity?.hash;
    const algo = (item.integrity?.algorithm ?? "").toUpperCase();
    if (!expected || algo !== "SHA256") continue;
    const actual = crypto.createHash("sha256").update(readFileFromAsar(asar, filePath)).digest("hex");
    checked += 1;
    if (actual !== expected) {
      bad.push(filePath);
      if (bad.length >= limit) break;
    }
  }
  return { checked, bad };
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
    // Pad by BYTE length: UTF-8 paths would otherwise make the 4-byte alignment
    // (and therefore every file offset) wrong. Mirrors readAsar(): head[4] - 8
    // is the padded header size, head[12] stays the raw JSON length.
    //
    // The filler byte is learned from the source archive instead of assumed:
    // electron-builder writes NUL and the legacy asar tool wrote spaces, and a
    // wrong guess turns an otherwise lossless re-pack into a different file.
    const padByte = asar.paddingByte ?? 0x00;
    const rawJson = Buffer.from(JSON.stringify(tree), "utf8");
    const padLen = (4 - (rawJson.length % 4)) % 4;
    const jsonBuf = padLen ? Buffer.concat([rawJson, Buffer.alloc(padLen, padByte)]) : rawJson;
    const head = Buffer.alloc(HEADER_SIZE);
    head.writeUInt32LE(4, 0);
    head.writeUInt32LE(jsonBuf.length + 8, 4);
    head.writeUInt32LE(jsonBuf.length + 4, 8);
    head.writeUInt32LE(rawJson.length, 12);

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

/**
 * Compare two archives region by region instead of by a single whole-file digest,
 * so a difference in the dead header padding can be told apart from a difference
 * in the JSON header or in the payload. `jsonLen` / `headerSize` are taken from
 * the source archive; both files must have the same size for `equal` to be true.
 */
export function compareArchives(aPath, bPath, { jsonLen, headerSize }) {
  const sizeA = fs.statSync(aPath).size;
  const sizeB = fs.statSync(bPath).size;
  const jsonStart = HEADER_SIZE;
  const paddingStart = jsonStart + jsonLen;
  const dataOffset = HEADER_SIZE + headerSize;
  const fdA = fs.openSync(aPath, "r");
  const fdB = fs.openSync(bPath, "r");
  const CHUNK = 1024 * 1024;
  const bufA = Buffer.allocUnsafe(CHUNK);
  const bufB = Buffer.allocUnsafe(CHUNK);
  const sameRange = (start, end) => {
    const len = Math.max(0, Math.min(end, Math.min(sizeA, sizeB)) - start);
    for (let pos = 0; pos < len; pos += CHUNK) {
      const want = Math.min(CHUNK, len - pos);
      const ra = fs.readSync(fdA, bufA, 0, want, start + pos);
      const rb = fs.readSync(fdB, bufB, 0, want, start + pos);
      if (ra !== want || rb !== want) return false;
      if (!bufA.subarray(0, want).equals(bufB.subarray(0, want))) return false;
    }
    return true;
  };
  try {
    const sizeEqual = sizeA === sizeB;
    const headerEqual = sameRange(0, jsonStart);
    const jsonEqual = sameRange(jsonStart, paddingStart);
    const paddingEqual = sameRange(paddingStart, dataOffset);
    const payloadEqual = sameRange(dataOffset, Math.max(sizeA, sizeB));
    return {
      equal: sizeEqual && headerEqual && jsonEqual && paddingEqual && payloadEqual,
      sizeEqual,
      headerEqual,
      jsonEqual,
      paddingEqual,
      payloadEqual,
      sizeA,
      sizeB,
    };
  } finally {
    fs.closeSync(fdA);
    fs.closeSync(fdB);
  }
}
