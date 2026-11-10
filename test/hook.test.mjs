// Hook installer tests: one line, installed at most once, shebang preserved.

import assert from "node:assert/strict";
import test from "node:test";
import { hasHook, hookLine, injectHook } from "../lib/hook.mjs";

test("injectHook prepends the import line", () => {
  const { source, injected } = injectHook('"use strict";\n');
  assert.equal(injected, true);
  assert.equal(source, hookLine() + '"use strict";\n');
  assert.ok(hasHook(source));
});

test("injectHook is idempotent", () => {
  const once = injectHook("code();\n").source;
  const twice = injectHook(once);
  assert.equal(twice.injected, false);
  assert.equal(twice.source, once);
  assert.equal(once.split("rsa-splash-hook").length - 1, 1, "hook appears exactly once");
});

test("injectHook recognizes an older marker and keeps the shebang first", () => {
  const withOlder = '/* old */ import("./rsa-splash.cjs");\nrun();\n';
  assert.equal(injectHook(withOlder).injected, false);
});

test("injectHook keeps a shebang as the first line", () => {
  const { source, injected } = injectHook("#!/usr/bin/env node\nmain();\n");
  assert.equal(injected, true);
  assert.ok(source.startsWith("#!/usr/bin/env node\n"), source.slice(0, 40));
  assert.ok(source.includes('import("./splash.cjs")'));
});

test("hookLine uses the given specifier", () => {
  const line = hookLine("./deep/splash.cjs");
  assert.ok(line.includes('import("./deep/splash.cjs")'));
  assert.ok(line.endsWith("\n"));
});
