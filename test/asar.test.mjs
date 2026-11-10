// Asar repacking tests: the previous repacker silently dropped replacements
// for paths that were not in the archive yet, which is exactly the first-deploy
// case (a clean official app.asar has no lib/splash.cjs).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readAsar, readFileFromAsar, repackAsar, walkFiles } from "../lib/asar.mjs";
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
      assert.equal(16 + asar.jsonLen + cursor, asar.size);
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
