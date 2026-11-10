// Deploy/apply tests against a throw-away host installation. The review on
// awesome-dsh-plugin#13322 found that a failed deploy left app.asar.rsa-new
// behind and that the next start copied it over the live app.asar, so both the
// cleanup path and the applyPending guards are covered here.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { applyPending, deploy, inspect } from "../lib/deploy.mjs";
import { DEFAULTS, normalizeConfig } from "../lib/defaults.mjs";
import { writeConfig } from "../lib/store.mjs";
import { buildAsar, hostFiles, makeFixture, readEntry } from "./helpers.mjs";

const config = normalizeConfig(DEFAULTS);
const isWindows = process.platform === "win32";

function overrides(fixture, extra = {}) {
  return { resources: fixture.resources, exe: fixture.exe, dataDir: fixture.dataDir, ...extra };
}

function hostVersion(asarPath) {
  return JSON.parse(readEntry(asarPath, "package.json").toString("utf8")).version;
}

test("deploy refuses non-Windows hosts before touching app.asar", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  } catch {
    t.skip("process.platform is not redefinable on this Node build");
    return;
  }
  const fixture = makeFixture();
  try {
    const before = fs.readFileSync(fixture.asar);
    const result = await deploy(config, overrides(fixture));
    assert.equal(result.ok, false);
    assert.equal(result.needsRestart, false);
    assert.match(result.error, /Windows-only/);
    assert.deepEqual(fs.readFileSync(fixture.asar), before);
    assert.equal(fs.existsSync(fixture.pending), false, "must not stage a pending asar");
  } finally {
    Object.defineProperty(process, "platform", descriptor);
    fixture.cleanup();
  }
});

test("deploy stages a pending asar with hook + splash module on a clean host", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  try {
    const result = await deploy(config, overrides(fixture));
    assert.equal(result.ok, true, result.error ?? "");
    assert.equal(result.hookInjected, true);
    assert.equal(result.staged, true);
    assert.equal(result.pending, fixture.pending);
    assert.ok(fs.existsSync(fixture.pending), "pending asar");
    assert.ok(fs.existsSync(fixture.backup), "backup asar");

    const main = readEntry(fixture.pending, "lib/main.js").toString("utf8");
    assert.ok(main.startsWith("/* rsa-splash-hook v8 */"), main.slice(0, 80));
    assert.match(main, /import\("\.\/splash\.cjs"\)/);
    assert.ok(main.includes('console.log("host main")'));

    const splash = readEntry(fixture.pending, "lib/splash.cjs").toString("utf8");
    assert.ok(splash.length > 1000, "generated splash module is not empty");
    assert.equal(readEntry(fixture.pending, "lib/other.js").toString("utf8"), hostFiles()["lib/other.js"]);

    // The live archive is untouched until the next host start.
    assert.equal(readEntry(fixture.asar, "lib/main.js").toString("utf8"), hostFiles()["lib/main.js"]);

    const state = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, "state.json"), "utf8"));
    assert.ok(state.lastDeployAt, "state.lastDeployAt");
    assert.equal(state.pendingAsar, fixture.pending);
  } finally {
    fixture.cleanup();
  }
});

test("deploy removes the pending asar when a later step fails", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  const blocker = path.join(fixture.root, "not-a-directory");
  fs.writeFileSync(blocker, "blocker");
  try {
    // dataDir points at a regular file, so writeState() throws after the pending
    // archive has already been written and validated.
    const result = await deploy(config, overrides(fixture, { dataDir: blocker }));
    assert.equal(result.ok, false);
    assert.ok(result.error, "error is reported");
    assert.equal(fs.existsSync(fixture.pending), false, "poisoned pending asar must be removed");
  } finally {
    fixture.cleanup();
  }
});

test("applyPending swaps a valid pending asar in and removes it", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  try {
    assert.equal((await deploy(config, overrides(fixture))).ok, true);

    const result = applyPending(overrides(fixture));
    assert.equal(result.applied, true, result.error ?? "");
    assert.equal(fs.existsSync(fixture.pending), false);

    const main = readEntry(fixture.asar, "lib/main.js").toString("utf8");
    assert.match(main, /rsa-splash-hook v8/);
    assert.ok(readEntry(fixture.asar, "lib/splash.cjs").length > 1000);
    assert.ok(fs.existsSync(fixture.backup));

    const state = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, "state.json"), "utf8"));
    assert.ok(state.lastAppliedAt);
    assert.equal(state.pendingAsar, null);
  } finally {
    fixture.cleanup();
  }
});

test("applyPending discards a damaged pending asar", { skip: !isWindows }, () => {
  const fixture = makeFixture();
  try {
    fs.writeFileSync(fixture.pending, "this is not an asar");
    const before = fs.readFileSync(fixture.asar);

    const result = applyPending(overrides(fixture));
    assert.equal(result.applied, false);
    assert.ok(result.error);
    assert.equal(fs.existsSync(fixture.pending), false, "damaged pending asar must be removed");
    assert.deepEqual(fs.readFileSync(fixture.asar), before, "live app.asar must not change");
  } finally {
    fixture.cleanup();
  }
});

test("inspect flags a deployed splash as stale once the config changes", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  try {
    assert.equal((await deploy(config, overrides(fixture))).ok, true);
    assert.equal(applyPending(overrides(fixture)).applied, true);

    const fresh = inspect(overrides(fixture));
    assert.equal(fresh.installed, true);
    assert.equal(fresh.stale, false);

    writeConfig({ ...config, tagline: { ...config.tagline, text: "changed tagline" } }, fixture.dataDir);
    const stale = inspect(overrides(fixture));
    assert.equal(stale.installed, true);
    assert.equal(stale.stale, true, "a config change must mark the splash stale");
  } finally {
    fixture.cleanup();
  }
});

test("applyPending discards a pending asar built for another host version", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  try {
    assert.equal((await deploy(config, overrides(fixture))).ok, true);
    // Simulate a host upgrade between deploy and restart.
    const upgraded = hostFiles({
      "package.json": JSON.stringify({ name: "@deepseek-ai/dsh-desktop", version: "9.9.10", main: "lib/main.js" }),
    });
    fs.writeFileSync(fixture.asar, buildAsar(upgraded));
    const before = fs.readFileSync(fixture.asar);

    const result = applyPending(overrides(fixture));
    assert.equal(result.applied, false);
    assert.match(result.error, /host app\.asar changed/);
    assert.equal(fs.existsSync(fixture.pending), false);
    assert.deepEqual(fs.readFileSync(fixture.asar), before);
    assert.equal(hostVersion(fixture.asar), "9.9.10");
  } finally {
    fixture.cleanup();
  }
});
