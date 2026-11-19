// Asar repacking tests: the previous repacker silently dropped replacements
// for paths that were not in the archive yet, which is exactly the first-deploy
// case (a clean official app.asar has no lib/splash.cjs).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readAsar, readFileFromAsar, repackAsar, verifyAsar, walkFiles, compareArchives } from "../lib/asar.mjs";
import { buildAsar, hostFiles, listEntries, makeFixture, readEntry } from "./helpers.mjs";

function withFixture(files, fn) {
  const fixture = makeFixture(files);
  try {
    return fn(fixture);
  } finally {
    fixture.cleanup();
  }
}

function repackInPlace(fixture, replacements) {
  const out = path.join(fixture.root, "repacked.asar");
  const asar = readAsar(fixture.asar);
  try {
    repackAsar(asar, out, replacements);
  } finally {
    fs.closeSync(asar.fd);
  }
  return out;
}

test("repackAsar replaces an existing file and keeps the other bytes", () =>
  withFixture({ "a.txt": "AAAA", "b.txt": "BB", "c.txt": "CCCCCC" }, (fixture) => {
    const out = repackInPlace(fixture, new Map([["b.txt", Buffer.from("BBBBBBBBBB")]]));
    assert.equal(readEntry(out, "a.txt").toString("utf8"), "AAAA");
    assert.equal(readEntry(out, "b.txt").toString("utf8"), "BBBBBBBBBB");
    assert.equal(readEntry(out, "c.txt").toString("utf8"), "CCCCCC");
  }));

test("repackAsar rewrites the integrity hash of a replaced file", () =>
  withFixture({ "a.txt": "AAAA", "b.txt": "BB" }, (fixture) => {
    const next = Buffer.from("next content");
    const out = repackInPlace(fixture, new Map([["b.txt", next]]));
    const asar = readAsar(out);
    try {
      const entry = walkFiles(asar.tree).find(({ path: filePath }) => filePath === "b.txt").item;
      const expected = crypto.createHash("sha256").update(next).digest("hex");
      assert.equal(entry.size, next.length);
      assert.equal(entry.integrity.hash, expected);
      assert.deepEqual(entry.integrity.blocks, [expected]);
    } finally {
      fs.closeSync(asar.fd);
    }
  }));

test("repackAsar appends new files (with missing directories) to a clean archive", () =>
  withFixture(hostFiles(), (fixture) => {
    const splash = Buffer.from("module.exports = 'splash';\n");
    const extra = Buffer.from("// deep\n");
    const out = repackInPlace(
      fixture,
      new Map([
        ["lib/splash.cjs", splash],
        ["deep/nested/extra.js", extra],
      ]),
    );

    const entries = listEntries(out);
    assert.ok(entries.includes("lib/splash.cjs"), entries.join(", "));
    assert.ok(entries.includes("deep/nested/extra.js"), entries.join(", "));
    assert.equal(readEntry(out, "lib/splash.cjs").toString("utf8"), splash.toString("utf8"));
    assert.equal(readEntry(out, "deep/nested/extra.js").toString("utf8"), extra.toString("utf8"));
    // Pre-existing entries keep their bytes after the append.
    assert.equal(readEntry(out, "lib/main.js").toString("utf8"), hostFiles()["lib/main.js"]);
    assert.equal(readEntry(out, "lib/other.js").toString("utf8"), hostFiles()["lib/other.js"]);
  }));

test("repackAsar reads back every entry at the offset the header advertises", () =>
  withFixture(hostFiles(), (fixture) => {
    const additions = new Map([
      ["lib/splash.cjs", Buffer.from("x".repeat(1000))],
      ["assets/a.bin", Buffer.from([0, 1, 2, 3, 255])],
    ]);
    const out = repackInPlace(fixture, additions);
    const asar = readAsar(out);
    try {
      const files = walkFiles(asar.tree);
      const byOffset = files
        .filter(({ item }) => item.offset !== undefined && !item.unpacked)
        .sort((a, b) => Number(a.item.offset) - Number(b.item.offset));
      let cursor = 0;
      for (const { path: filePath, item } of byOffset) {
        assert.equal(Number(item.offset), cursor, `${filePath} offset`);
        const bytes = readFileFromAsar(asar, filePath);
        assert.equal(bytes.length, item.size, `${filePath} size`);
        cursor += item.size;
      }
      assert.equal(asar.dataOffset + cursor, asar.size);
    } finally {
      fs.closeSync(asar.fd);
    }
  }));

test("repackAsar refuses an addition whose parent is a file", () =>
  withFixture({ "package.json": "{}", lib: "i am a file" }, (fixture) => {
    assert.throws(
      () => repackInPlace(fixture, new Map([["lib/splash.cjs", Buffer.from("nope")]])),
      /is a file in the asar/,
    );
  }));

test("repackAsar copies the payload unchanged when nothing is replaced", () =>
  withFixture(hostFiles(), (fixture) => {
    const out = repackInPlace(fixture, new Map());
    for (const filePath of Object.keys(hostFiles())) {
      assert.equal(readEntry(out, filePath).toString("utf8"), hostFiles()[filePath]);
    }
    assert.deepEqual(listEntries(out).sort(), Object.keys(hostFiles()).sort());
  }));

// Regression: electron-builder pads the header JSON to a 4-byte boundary, so
// head[12] (raw JSON length) is NOT the distance to the payload. Reading
// dataOffset as `16 + head[12]` shifted every file by up to 3 bytes, which made
// the repacked app.asar unloadable (DSH died at startup with no useful error).
function archiveWithPaddedHeader(files, options = {}) {
  for (let n = 0; n < 8; n += 1) {
    const buf = buildAsar({ ...files, [`pad-${n}.txt`]: "x".repeat(n) }, options);
    const jsonLen = buf.readUInt32LE(12);
    if (jsonLen % 4 !== 0) return buf;
  }
  throw new Error("fixture builder could not produce a padded header");
}

test("readAsar uses the padded header size, not the raw JSON length", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "dsh-rsa-pad-"));
  try {
    const file = path.join(dir, "app.asar");
    const files = { "package.json": JSON.stringify({ main: "lib/main.js" }), "lib/main.js": "alpha" };
    fs.writeFileSync(file, archiveWithPaddedHeader(files));
    const asar = readAsar(file);
    try {
      assert.notEqual(asar.jsonLen % 4, 0, "fixture must have a padded header");
      assert.ok(asar.headerSize > asar.jsonLen, "padded header should be longer than the raw JSON");
      assert.equal(asar.dataOffset, 16 + asar.headerSize);
      const head = fs.readFileSync(file).subarray(0, 16);
      assert.equal(asar.dataOffset - 16, head.readUInt32LE(4) - 8);
      for (const [filePath, expected] of Object.entries(files)) {
        assert.equal(readFileFromAsar(asar, filePath).toString("utf8"), expected, filePath);
      }
      const { checked, bad } = verifyAsar(asar);
      assert.ok(checked >= 2);
      assert.deepEqual(bad, []);
    } finally {
      fs.closeSync(asar.fd);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("repackAsar keeps a padded-header archive byte-exact", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "dsh-rsa-pad-repack-"));
  try {
    const files = hostFiles({ "assets/blob.bin": Buffer.from([1, 2, 3, 4, 5, 6, 7]) });
    const source = path.join(dir, "app.asar");
    fs.writeFileSync(source, archiveWithPaddedHeader(files));
    const out = path.join(dir, "repacked.asar");
    const asar = readAsar(source);
    try {
      repackAsar(asar, out, new Map([["lib/main.js", Buffer.from("hooked!\n")]]));
    } finally {
      fs.closeSync(asar.fd);
    }
    const packed = readAsar(out);
    try {
      assert.equal(readFileFromAsar(packed, "lib/main.js").toString("utf8"), "hooked!\n");
      for (const [filePath, expected] of Object.entries(files)) {
        if (filePath === "lib/main.js") continue;
        const want = Buffer.isBuffer(expected) ? expected : Buffer.from(expected, "utf8");
        assert.deepEqual(readFileFromAsar(packed, filePath), want, filePath);
      }
      assert.deepEqual(verifyAsar(packed).bad, []);
    } finally {
      fs.closeSync(packed.fd);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyAsar catches a payload shifted out from under the header", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "dsh-rsa-corrupt-"));
  try {
    const file = path.join(dir, "app.asar");
    const buf = Buffer.from(buildAsar({ "a.txt": "AAAA", "b.txt": "BBBB" }));
    fs.writeFileSync(file, buf);
    // Flip one payload byte: the header stays self-consistent, the bytes no longer match.
    buf[buf.length - 1] ^= 0xff;
    fs.writeFileSync(file, buf);
    const asar = readAsar(file);
    try {
      const { bad } = verifyAsar(asar);
      assert.deepEqual(bad, ["b.txt"]);
    } finally {
      fs.closeSync(asar.fd);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildAsar fixture is readable by readAsar", () => {
  const buf = buildAsar({ "package.json": JSON.stringify({ main: "lib/main.js" }), "lib/main.js": "x" });
  assert.ok(buf.length > 16);
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "dsh-rsa-asar-"));
  try {
    const file = path.join(dir, "app.asar");
    fs.writeFileSync(file, buf);
    const asar = readAsar(file);
    try {
      assert.equal(readFileFromAsar(asar, "lib/main.js").toString("utf8"), "x");
    } finally {
      fs.closeSync(asar.fd);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The header's dead padding is never read by Electron, but it is part of the
// file. electron-builder fills it with NUL while older asar tooling filled it
// with a space; the repacker used to hardcode the space, so a round trip of the
// real DSH build reported "same size, different bytes" and blocked deployment.
// The writer must reproduce whatever byte the host used, not its own favourite.
const PAD_CASES = [
  ["NUL", 0x00],
  ["space", 0x20],
];

function withPaddedDir(name, fn) {
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", `dsh-rsa-${name}-`));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("readAsar reports the padding byte the host wrote", () =>
  withPaddedDir("padbyte", (dir) => {
    const files = { "package.json": JSON.stringify({ main: "lib/main.js" }), "lib/main.js": "alpha" };
    for (const [label, paddingByte] of PAD_CASES) {
      const file = path.join(dir, `${label}.asar`);
      fs.writeFileSync(file, archiveWithPaddedHeader(files, { paddingByte }));
      const asar = readAsar(file);
      try {
        assert.equal(asar.padding.length, asar.headerSize - asar.jsonLen, `${label}: padding length`);
        assert.ok(asar.padding.length > 0, `${label}: fixture must be padded`);
        assert.equal(asar.paddingByte, paddingByte, `${label}: padding byte`);
        assert.equal(readFileFromAsar(asar, "lib/main.js").toString("utf8"), "alpha", `${label}: payload still readable`);
      } finally {
        fs.closeSync(asar.fd);
      }
    }
  }));

test("repackAsar writes back the host's padding byte, so a clean repack is byte-identical", () =>
  withPaddedDir("padrepack", (dir) => {
    const files = hostFiles({ "assets/blob.bin": Buffer.from([1, 2, 3, 4, 5]) });
    for (const [label, paddingByte] of PAD_CASES) {
      const source = path.join(dir, `${label}-src.asar`);
      const out = path.join(dir, `${label}-out.asar`);
      fs.writeFileSync(source, archiveWithPaddedHeader(files, { paddingByte }));
      const asar = readAsar(source);
      let meta;
      try {
        repackAsar(asar, out, new Map());
        meta = { jsonLen: asar.jsonLen, headerSize: asar.headerSize };
      } finally {
        fs.closeSync(asar.fd);
      }
      const cmp = compareArchives(source, out, meta);
      assert.equal(cmp.equal, true, `${label}: repack must be byte-identical (${JSON.stringify(cmp)})`);
      assert.equal(cmp.paddingEqual, true, `${label}: padding must be preserved`);
    }
  }));

test("compareArchives tells a padding-only difference from a real one", () =>
  withPaddedDir("cmparch", (dir) => {
    const files = hostFiles({ "assets/blob.bin": Buffer.from([9, 8, 7, 6, 5]) });
    const source = path.join(dir, "nul.asar");
    const spaced = path.join(dir, "space.asar");
    fs.writeFileSync(source, archiveWithPaddedHeader(files, { paddingByte: 0x00 }));
    fs.writeFileSync(spaced, archiveWithPaddedHeader(files, { paddingByte: 0x20 }));

    const asar = readAsar(source);
    let meta;
    try {
      meta = { jsonLen: asar.jsonLen, headerSize: asar.headerSize };
    } finally {
      fs.closeSync(asar.fd);
    }

    const paddingOnly = compareArchives(source, spaced, meta);
    assert.equal(paddingOnly.equal, false, "different padding is not byte-equal");
    assert.equal(paddingOnly.sizeEqual, true);
    assert.equal(paddingOnly.jsonEqual, true);
    assert.equal(paddingOnly.payloadEqual, true);
    assert.equal(paddingOnly.paddingEqual, false);

    // Now make a real difference: flip a payload byte.
    const corrupted = path.join(dir, "corrupt.asar");
    const buf = fs.readFileSync(source);
    const asarForOffset = readAsar(source);
    const at = asarForOffset.dataOffset + 2;
    fs.closeSync(asarForOffset.fd);
    buf[at] ^= 0xff;
    fs.writeFileSync(corrupted, buf);
    const real = compareArchives(source, corrupted, meta);
    assert.equal(real.equal, false);
    assert.equal(real.payloadEqual, false);
    assert.equal(real.paddingEqual, true);
    assert.equal(real.jsonEqual, true);
  }));
