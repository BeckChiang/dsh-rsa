// Route-level guards. Deployment writes into the running host's app.asar, so the
// two safety nets live in the HTTP layer: an unconfirmed request must be refused
// before any check runs, and /state must carry the compatibility verdict the
// banner depends on. Both are cheap to assert and expensive to get wrong.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import test, { after } from "node:test";
import { handle, setPathOverrides } from "../index.js";
import { makeFixture } from "./helpers.mjs";

after(() => setPathOverrides({}));

function fakeReq(method, path, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body, "utf8")]);
  req.method = method;
  req.url = path;
  req.headers = { host: "127.0.0.1:3081", "content-type": "application/json" };
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

function fakeRes() {
  const out = { status: 0, headers: null, body: "" };
  const res = {
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers;
    },
    end(chunk) {
      out.body = chunk ? chunk.toString("utf8") : "";
    },
    setHeader() {},
    getHeader() {
      return undefined;
    },
  };
  return { res, out };
}

// Routes must resolve the install from module state, never from the cordis
// context: that context is a proxy which throws on undeclared props, and one
// such read escaped into the settings page as
// `cannot get property "rsaPaths" without inject`. strictCtx() reproduces the
// proxy so the same mistake fails here instead of in the running app.
function strictCtx() {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        throw new Error(`cannot get property "${String(prop)}" without inject`);
      },
    },
  );
}

function ctxFor(fixture) {
  setPathOverrides({ resources: fixture.resources, exe: fixture.exe, dataDir: fixture.dataDir });
  return strictCtx();
}

async function call(ctx, method, path, body) {
  const { res, out } = fakeRes();
  await handle(ctx, fakeReq(method, path, body), res);
  return { status: out.status, json: out.body ? JSON.parse(out.body) : null };
}

test("deploy is refused without explicit confirmation", async () => {
  const fixture = makeFixture();
  try {
    const ctx = ctxFor(fixture);
    const before = fs.statSync(fixture.asar).mtimeMs;
    const r = await call(ctx, "POST", "/rsa/deploy", JSON.stringify({}));
    assert.equal(r.status, 400);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, "confirmation required");
    assert.equal(r.json.needConfirm, true);
    assert.match(r.json.rollback, /rsa-rollback\.cmd$/);
    assert.equal(fs.statSync(fixture.asar).mtimeMs, before, "app.asar must not be touched");
    assert.equal(fs.existsSync(fixture.asar + ".rsa-new"), false, "nothing may be staged");
  } finally {
    fixture.cleanup();
  }
});

test("deploy refuses a body whose confirmation is not the literal true", async () => {
  const fixture = makeFixture();
  try {
    const r = await call(ctxFor(fixture), "POST", "/rsa/deploy", JSON.stringify({ confirmed: "yes" }));
    assert.equal(r.status, 400);
    assert.equal(r.json.needConfirm, true);
  } finally {
    fixture.cleanup();
  }
});

test("state carries the compatibility verdict used by the banner", async () => {
  const fixture = makeFixture();
  try {
    const r = await call(ctxFor(fixture), "GET", "/rsa/state");
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    const compat = r.json.compat;
    assert.ok(compat, "/state must expose compat");
    assert.equal(typeof compat.needed, "boolean");
    assert.equal(compat.needed, true, "a fresh install still needs a check");
    assert.equal(compat.reason, "first-run");
    assert.equal(compat.hostVersion, "9.9.9");
    assert.match(r.json.paths.rollback, /rsa-rollback\.cmd$/);
  } finally {
    fixture.cleanup();
  }
});

test("a full check is recorded and clears the banner", async () => {
  const fixture = makeFixture();
  try {
    const ctx = ctxFor(fixture);
    const first = await call(ctx, "GET", "/rsa/compat");
    assert.equal(first.status, 200);
    assert.equal(first.json.report.ok, true, first.json.report.error || JSON.stringify(first.json.report.checks));
    assert.equal(first.json.compat.needed, false);
    const again = await call(ctx, "GET", "/rsa/state");
    assert.equal(again.json.compat.needed, false);
    assert.equal(again.json.compat.last.hostVersion, "9.9.9");
    assert.equal(again.json.compat.last.ok, true);
  } finally {
    fixture.cleanup();
  }
});

test("a host update makes the recorded check stale again", async () => {
  const fixture = makeFixture();
  try {
    const ctx = ctxFor(fixture);
    await call(ctx, "GET", "/rsa/compat");
    // Pretend the recorder saw a different host build last time.
    fs.writeFileSync(
      path.join(fixture.dataDir, "state.json"),
      JSON.stringify({ lastCompatAt: new Date().toISOString(), lastCompatHostVersion: "0.0.1", lastCompatOk: true }),
    );
    const r = await call(ctx, "GET", "/rsa/state");
    assert.equal(r.json.compat.needed, true);
    assert.equal(r.json.compat.reason, "host-updated");
  } finally {
    fixture.cleanup();
  }
});

test("a fixture deployment never rewrites the shipped rollback script", async () => {
  const fixture = makeFixture();
  try {
    // No pluginDir on purpose: the guard must refuse to bake temp paths into the
    // script that ships with the real plugin (this happened once during 0.2.5).
    const { ensureRollbackScript, rollbackPath } = await import("../lib/rollback.mjs");
    const shipped = rollbackPath();
    const before = fs.existsSync(shipped) ? fs.readFileSync(shipped, "utf8") : null;
    const target = ensureRollbackScript({ resources: fixture.resources, exe: fixture.exe });
    assert.equal(target, shipped);
    const after = fs.existsSync(shipped) ? fs.readFileSync(shipped, "utf8") : null;
    assert.equal(after, before, "shipped script must stay untouched");
  } finally {
    fixture.cleanup();
  }
});
