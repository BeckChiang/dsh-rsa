// Compatibility checks run before every deploy. The point of these tests is the
// failure direction: a host whose archive layout changed must be reported as
// incompatible *before* anything is written into app.asar, because the previous
// bug only surfaced as "DSH does not start".

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { checkCompatibility, compatStatus, hostVersionAt } from "../lib/compat.mjs";
import { hostFiles, makeFixture } from "./helpers.mjs";
import { readAsar } from "../lib/asar.mjs";

function overrides(fixture) {
  return { resources: fixture.resources, exe: fixture.exe };
}

test("compat accepts a structurally valid host archive", () => {
  const fixture = makeFixture();
  try {
    const report = checkCompatibility(overrides(fixture), { full: true });
    assert.equal(report.ok, true, report.error || JSON.stringify(report.checks));
    const ids = report.checks.map((c) => c.id);
    assert.ok(ids.includes("header"), "header check must run");
    assert.ok(ids.includes("layout"), "layout check must run");
    assert.ok(ids.includes("integrity"), "integrity check must run");
    assert.ok(ids.includes("entry"), "entry check must run");
    assert.ok(ids.includes("roundtrip"), "roundtrip check must run");
    assert.ok(ids.includes("version"), "version check must run");
    assert.equal(report.hostMain, "lib/main.js");
    assert.equal(report.hostVersion, "9.9.9");
  } finally {
    fixture.cleanup();
  }
});

test("compat reports a truncated payload as incompatible", () => {
  const fixture = makeFixture();
  try {
    const buf = fs.readFileSync(fixture.asar);
    fs.writeFileSync(fixture.asar, buf.subarray(0, buf.length - 4));
    const report = checkCompatibility(overrides(fixture), { full: false });
    assert.equal(report.ok, false);
    const layout = report.checks.find((c) => c.id === "layout");
    assert.ok(layout && layout.ok === false, "layout check must fail on a truncated payload");
  } finally {
    fixture.cleanup();
  }
});

test("compat reports a corrupted payload as incompatible", () => {
  const fixture = makeFixture();
  try {
    // Flip one payload byte, the way a shifted repack used to corrupt entries.
    const asar = readAsar(fixture.asar);
    const at = asar.dataOffset + 3;
    fs.closeSync(asar.fd);
    const buf = fs.readFileSync(fixture.asar);
    buf[at] = buf[at] ^ 0xff;
    fs.writeFileSync(fixture.asar, buf);
    const report = checkCompatibility(overrides(fixture), { full: false });
    assert.equal(report.ok, false);
    const integrity = report.checks.find((c) => c.id === "integrity");
    assert.ok(integrity && integrity.ok === false, "integrity check must fail on a corrupted payload");
  } finally {
    fixture.cleanup();
  }
});

test("compat reports a malformed main entry as incompatible", () => {
  const fixture = makeFixture(hostFiles({ "lib/main.js": "this is not javascript (((" }));
  try {
    const report = checkCompatibility(overrides(fixture), { full: true });
    const entry = report.checks.find((c) => c.id === "entry");
    assert.ok(entry && entry.ok === false, "entry check must fail on an unparsable main file");
    assert.equal(report.ok, false);
  } finally {
    fixture.cleanup();
  }
});

test("compat flags an untested host version as a warning, not a failure", () => {
  const fixture = makeFixture();
  try {
    const report = checkCompatibility(overrides(fixture), { full: false });
    const version = report.checks.find((c) => c.id === "version");
    assert.ok(version, "version check must run");
    assert.equal(version.warn, true, "9.9.9 is not in the tested list, so it must warn");
    assert.equal(report.ok, true, "a warning must not block deployment");
  } finally {
    fixture.cleanup();
  }
});

test("compat survives a missing app.asar", () => {
  const fixture = makeFixture();
  try {
    fs.rmSync(fixture.asar);
    const report = checkCompatibility(overrides(fixture), { full: false });
    assert.equal(report.ok, false);
    assert.match(report.error, /not found/);
  } finally {
    fixture.cleanup();
  }
});

test("compat is a pure read: the archive is byte-identical afterwards", () => {
  const fixture = makeFixture();
  try {
    const before = fs.readFileSync(fixture.asar);
    checkCompatibility(overrides(fixture), { full: true });
    assert.deepEqual(fs.readFileSync(fixture.asar), before);
  } finally {
    fixture.cleanup();
  }
});

// The banner decides when to nag: first install, and after a host update that
// replaced app.asar under us. A verdict recorded against another build must not
// be reused, which is exactly how a stale "passed" could green-light a deploy
// onto a layout we never tested.
test("compatStatus asks for a check on a fresh install", () => {
  const fixture = makeFixture();
  try {
    const host = hostVersionAt(fixture.asar);
    assert.equal(host.ok, true);
    assert.equal(host.version, "9.9.9");
    const status = compatStatus(fixture.asar, {});
    assert.equal(status.needed, true);
    assert.equal(status.reason, "first-run");
    assert.equal(status.hostVersion, "9.9.9");
    assert.equal(status.last.at, null);
  } finally {
    fixture.cleanup();
  }
});

test("compatStatus stays quiet when the recorded check matches the host build", () => {
  const fixture = makeFixture();
  try {
    const status = compatStatus(fixture.asar, {
      lastCompatAt: "2026-01-01T00:00:00.000Z",
      lastCompatHostVersion: "9.9.9",
      lastCompatOk: true,
      lastCompatFull: true,
    });
    assert.equal(status.needed, false);
    assert.equal(status.reason, null);
    assert.equal(status.last.ok, true);
  } finally {
    fixture.cleanup();
  }
});

test("compatStatus re-asks after the host build changes", () => {
  const fixture = makeFixture();
  try {
    const status = compatStatus(fixture.asar, {
      lastCompatAt: "2026-01-01T00:00:00.000Z",
      lastCompatHostVersion: "9.9.8",
      lastCompatOk: true,
    });
    assert.equal(status.needed, true);
    assert.equal(status.reason, "host-updated");
    assert.equal(status.last.hostVersion, "9.9.8");
    assert.equal(status.hostVersion, "9.9.9");
  } finally {
    fixture.cleanup();
  }
});

test("compatStatus keeps nagging after a failed check on the same build", () => {
  const fixture = makeFixture();
  try {
    const status = compatStatus(fixture.asar, {
      lastCompatAt: "2026-01-01T00:00:00.000Z",
      lastCompatHostVersion: "9.9.9",
      lastCompatOk: false,
    });
    assert.equal(status.needed, true);
    assert.equal(status.reason, "last-failed");
  } finally {
    fixture.cleanup();
  }
});

test("compatStatus reports a missing archive as unavailable", () => {
  const fixture = makeFixture();
  try {
    const gone = fixture.asar + ".nope";
    const status = compatStatus(gone, { lastCompatAt: "2026-01-01T00:00:00.000Z", lastCompatHostVersion: "9.9.9", lastCompatOk: true });
    assert.equal(status.needed, true);
    assert.equal(status.reason, "no-host");
    assert.equal(status.hostVersion, null);
    assert.ok(status.hostError);
  } finally {
    fixture.cleanup();
  }
});
