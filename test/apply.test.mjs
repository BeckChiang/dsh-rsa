// The exit-time swap is the step that used to silently do nothing (rename-only)
// and, before that, silently corrupted the archive. These tests pin the three
// outcomes that matter: applied while the host still holds the file, validated
// but not swapped at startup, and a damaged pending file discarded untouched.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { applyPending, deploy, inspect } from "../lib/deploy.mjs";
import { DEFAULTS, normalizeConfig } from "../lib/defaults.mjs";
import { readState } from "../lib/store.mjs";
import { readAsar, readFileFromAsar } from "../lib/asar.mjs";
import { rollbackPath } from "../lib/rollback.mjs";
import { buildAsar, hostFiles, makeFixture, readEntry } from "./helpers.mjs";

const config = normalizeConfig(DEFAULTS);
const isWindows = process.platform === "win32";

function overrides(fixture) {
  return {
    resources: fixture.resources,
    exe: fixture.exe,
    dataDir: fixture.dataDir,
    pluginDir: path.join(fixture.root, "plugin"),
  };
}

function entries(asarPath) {
  const asar = readAsar(asarPath);
  try {
    return { hasSplash: Boolean(asar.tree.files?.lib?.files?.["splash.cjs"]), main: readFileFromAsar(asar, "lib/main.js").toString("utf8") };
  } finally {
    fs.closeSync(asar.fd);
  }
}

async function stage(fixture) {
  const result = await deploy(config, overrides(fixture));
  assert.equal(result.ok, true, result.error || "deploy failed");
  assert.equal(fs.existsSync(fixture.pending), true, "deploy must stage app.asar.rsa-new");
  return result;
}

test("deploy writes the rollback script into the plugin directory", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  try {
    const result = await stage(fixture);
    const script = rollbackPath(overrides(fixture));
    assert.equal(result.rollbackScript, script);
    assert.equal(fs.existsSync(script), true, "rollback script must exist after a deploy");
    const body = fs.readFileSync(script, "utf8");
    assert.ok(body.includes(fixture.resources), "the script must bake in the resolved resources path");
    assert.ok(body.includes("tasklist"), "the script must refuse to run while DSH is up");
    assert.equal(inspect(overrides(fixture)).rollbackScript, script);
  } finally {
    fixture.cleanup();
  }
});

test("applyPending swaps the staged archive in while the host still holds it open", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  let held;
  try {
    await stage(fixture);
    const before = fs.readFileSync(fixture.asar);
    assert.equal(entries(fixture.asar).hasSplash, false, "live archive must not carry the splash yet");

    // Simulate the running host: an open handle on app.asar. A rename over it is
    // refused by Windows, which is exactly the case the copy path has to cover.
    held = fs.openSync(fixture.asar, "r");

    const applied = applyPending(overrides(fixture));
    assert.equal(applied.ok, true, applied.error || "apply failed");
    assert.equal(applied.applied, true);
    assert.equal(applied.mode, "copy", "an open live archive forces the copy path");
    assert.equal(fs.existsSync(fixture.pending), false, "the pending file must be gone after a swap");

    const after = entries(fixture.asar);
    assert.equal(after.hasSplash, true, "the swapped archive must contain lib/splash.cjs");
    assert.match(after.main, /rsa-splash-hook/);
    assert.notDeepEqual(fs.readFileSync(fixture.asar), before);

    const state = readState(fixture.dataDir);
    assert.equal(state.lastApplyResult, "applied (copy)");
    assert.equal(state.lastApplyMode, "copy");
    assert.equal(state.pendingAsar, null);

    // The backup is the pristine host archive and is what the rollback script uses.
    assert.deepEqual(fs.readFileSync(fixture.backup), before);
  } finally {
    if (held !== undefined) fs.closeSync(held);
    fixture.cleanup();
  }
});

test("applyPending at startup validates but never touches the live archive", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  try {
    await stage(fixture);
    const before = fs.readFileSync(fixture.asar);
    const out = applyPending({ ...overrides(fixture), at: "startup" });
    assert.equal(out.ok, true, out.error || "startup validation failed");
    assert.equal(out.validated, true);
    assert.equal(out.applied, false);
    assert.equal(fs.existsSync(fixture.pending), true, "the pending file stays armed for exit");
    assert.deepEqual(fs.readFileSync(fixture.asar), before);
  } finally {
    fixture.cleanup();
  }
});

test("applyPending discards a damaged pending file and leaves the host intact", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  try {
    await stage(fixture);
    const before = fs.readFileSync(fixture.asar);
    // Three bytes inserted in the payload: the exact shape of the old bug.
    const staged = fs.readFileSync(fixture.pending);
    fs.writeFileSync(fixture.pending, Buffer.concat([staged.subarray(0, 200), Buffer.from([1, 2, 3]), staged.subarray(200)]));

    const out = applyPending(overrides(fixture));
    assert.equal(out.applied, false);
    assert.ok(out.error, "a damaged pending file must be reported");
    assert.equal(fs.existsSync(fixture.pending), false, "a damaged pending file must not stay armed");
    assert.deepEqual(fs.readFileSync(fixture.asar), before, "the live archive must not change");
    assert.equal(readState(fixture.dataDir).lastApplyResult.startsWith("discarded:"), true);
  } finally {
    fixture.cleanup();
  }
});

test("applyPending discards a pending file built for another host version", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  try {
    await stage(fixture);
    // Host replaced by an upgrade after the deployment was staged.
    const upgraded = hostFiles({ "package.json": JSON.stringify({ name: "@deepseek-ai/dsh-desktop", version: "10.0.0", main: "lib/main.js" }) });
    fs.writeFileSync(fixture.asar, buildAsar(upgraded));
    const before = fs.readFileSync(fixture.asar);

    const out = applyPending(overrides(fixture));
    assert.equal(out.applied, false);
    assert.match(out.error, /changed since deployment/);
    assert.equal(fs.existsSync(fixture.pending), false);
    assert.deepEqual(fs.readFileSync(fixture.asar), before, "the upgraded archive must not be replaced");
  } finally {
    fixture.cleanup();
  }
});

test("applyPending is a no-op when nothing is staged", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  try {
    const before = fs.readFileSync(fixture.asar);
    const out = applyPending(overrides(fixture));
    assert.equal(out.skipped, true);
    assert.equal(out.applied, false);
    assert.deepEqual(fs.readFileSync(fixture.asar), before);
  } finally {
    fixture.cleanup();
  }
});

test("a second deploy after a successful swap still verifies", { skip: !isWindows }, async () => {
  const fixture = makeFixture();
  try {
    await stage(fixture);
    assert.equal(applyPending(overrides(fixture)).applied, true);
    // Now the live archive already carries the hook; a redeploy must cope with
    // that (the hook is not injected twice) and still verify.
    const again = await deploy(config, overrides(fixture));
    assert.equal(again.ok, true, again.error || "redeploy over a patched archive failed");
    const applied = applyPending(overrides(fixture));
    assert.equal(applied.ok, true, applied.error || "second swap failed");
    const { main } = entries(fixture.asar);
    assert.equal((main.match(/rsa-splash-hook/g) || []).length, 1, "the hook must not be injected twice");
    assert.equal(readEntry(fixture.asar, "package.json").toString("utf8").includes("@deepseek-ai"), true);
  } finally {
    fixture.cleanup();
  }
});
