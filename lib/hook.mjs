/**
 * Splash hook installer.
 *
 * The desktop app's main entry only needs ONE line prepended so that the splash
 * module is loaded at startup:
 *
 *     /* rsa-splash-hook v8 *\/ import("./splash.cjs").catch(() => {});
 *
 * Everything else — waiting for `app` to be ready, creating the window, closing
 * it when the real window shows, timeouts — lives inside the generated
 * `lib/splash.cjs` (see render.mjs). That keeps this patch one line long, makes
 * it independent of how the host's main.js is structured (ESM or CJS), and lets
 * future splash behaviour changes ship by re-deploying the module alone.
 *
 * Dynamic `import()` is valid in both ESM and CJS, so the same line works after
 * a host rewrite or a major upgrade.
 */

export const HOOK_VERSION = "v8";

/** Markers that prove the entry already loads our splash module. */
export const HOOK_MARKERS = ["./splash.cjs", "./rsa-splash.cjs"];

export function hasHook(source) {
  return HOOK_MARKERS.some((marker) => source.includes(marker));
}

/** The single line that gets prepended to the host main entry. */
export function hookLine(specifier = "./splash.cjs") {
  return `/* rsa-splash-hook ${HOOK_VERSION} */ import(${JSON.stringify(specifier)}).catch(() => {});\n`;
}

/**
 * Prepend the hook to `source`.
 * Returns `{ source, injected }`; `injected` is false when a marker is already
 * present, so deploying twice never stacks lines.
 */
export function injectHook(source, specifier = "./splash.cjs") {
  if (hasHook(source)) return { source, injected: false };
  const line = hookLine(specifier);
  // Keep a shebang as the very first line.
  if (source.startsWith("#!")) {
    const newline = source.indexOf("\n");
    if (newline !== -1) {
      return { source: source.slice(0, newline + 1) + line + source.slice(newline + 1), injected: true };
    }
  }
  return { source: line + source, injected: true };
}
