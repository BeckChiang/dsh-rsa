// Default configuration for Real startup animation (RSA).
// The values mirror the current hand-tuned v7 splash, so "restore defaults"
// reproduces the design the user already approved.

export const DEFAULTS = Object.freeze({
  version: 1,
  window: {
    width: 520,
    height: 308,
    radius: 26,
  },
  theme: {
    // "system" follows nativeTheme.shouldUseDarkColors; "light" / "dark" pin it.
    mode: "system",
    lightAlpha: 0.86,
    darkAlpha: 0.80,
  },
  logo: {
    scale: 1,
    width: 320,
    top: 74,
    // Empty means the bundled DeepSeek Harness lockup. A non-empty value is an
    // absolute path to a PNG; RSA embeds it as a data URL at deploy time.
    customLight: "",
    customDark: "",
  },
  tagline: {
    text: "I Want I Make",
    size: 26,
    family: "Segoe UI",
    weight: 600,
    italic: true,
    top: 160,
    // "rise" (per-letter), "fade" (whole line), "none"
    effect: "rise",
    period: 4.8,
    delay: 46,
    letterSpacing: 0.5,
  },
  credit: {
    text: "Rebuild by BeckChiang",
    size: 11.5,
    visible: true,
    // "bottom-right" | "bottom-left" | "top-right" | "top-left"
    position: "bottom-right",
    offsetX: 24,
    offsetY: 16,
  },
  blobs: {
    enabled: true,
    // "float" | "still"
    motion: "float",
    speed: 1,
    alphaA: 0.58,
    alphaB: 0.48,
  },
  ring: {
    enabled: true,
    // "band" | "dots" | "breathe"
    style: "band",
    length: 172,
    period: 4.2,
    tail: true,
    width: 2.2,
  },
});

const LIMITS = {
  width: [320, 1200],
  height: [200, 900],
  radius: [0, 80],
  alpha: [0.2, 1],
  size: [8, 96],
  top: [0, 900],
  period: [0.8, 30],
  delay: [0, 400],
  length: [10, 1600],
  speed: [0.2, 4],
};

function clampNumber(value, min, max, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function text(value, fallback, max = 200) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.replace(/[\u0000-\u001f]/g, "").trim();
  return trimmed.length === 0 ? fallback : trimmed.slice(0, max);
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** Coerce arbitrary JSON into a valid RSA config. Never throws. */
export function normalizeConfig(input) {
  const raw = input && typeof input === "object" ? input : {};
  const d = DEFAULTS;
  const win = raw.window ?? {};
  const theme = raw.theme ?? {};
  const logo = raw.logo ?? {};
  const tagline = raw.tagline ?? {};
  const credit = raw.credit ?? {};
  const blobs = raw.blobs ?? {};
  const ring = raw.ring ?? {};

  return {
    version: 1,
    window: {
      width: clampNumber(win.width, ...LIMITS.width, d.window.width),
      height: clampNumber(win.height, ...LIMITS.height, d.window.height),
      radius: clampNumber(win.radius, ...LIMITS.radius, d.window.radius),
    },
    theme: {
      mode: pick(theme.mode, ["system", "light", "dark"], d.theme.mode),
      lightAlpha: clampNumber(theme.lightAlpha, ...LIMITS.alpha, d.theme.lightAlpha),
      darkAlpha: clampNumber(theme.darkAlpha, ...LIMITS.alpha, d.theme.darkAlpha),
    },
    logo: (() => {
      const base = 320;
      const fallback = logo.width ? logo.width / base : d.logo.scale;
      const scale = clampNumber(logo.scale ?? fallback, 0.1, 5, d.logo.scale);
      return {
        scale,
        width: Math.round(base * scale),
        top: clampNumber(logo.top, ...LIMITS.top, d.logo.top),
      customLight: typeof logo.customLight === "string" ? logo.customLight.slice(0, 500) : "",
      customDark: typeof logo.customDark === "string" ? logo.customDark.slice(0, 500) : "",
      };
    })(),
    tagline: {
      text: text(tagline.text, d.tagline.text, 120),
      size: clampNumber(tagline.size, ...LIMITS.size, d.tagline.size),
      family: text(tagline.family, d.tagline.family, 80),
      weight: clampNumber(tagline.weight, 100, 900, d.tagline.weight),
      italic: tagline.italic !== false,
      top: clampNumber(tagline.top, ...LIMITS.top, d.tagline.top),
      effect: pick(tagline.effect, ["rise", "fade", "none"], d.tagline.effect),
      period: clampNumber(tagline.period, ...LIMITS.period, d.tagline.period),
      delay: clampNumber(tagline.delay, ...LIMITS.delay, d.tagline.delay),
      letterSpacing: clampNumber(tagline.letterSpacing, -5, 20, d.tagline.letterSpacing),
    },
    credit: {
      text: text(credit.text, d.credit.text, 80),
      size: clampNumber(credit.size, 6, 40, d.credit.size),
      visible: credit.visible !== false,
      position: pick(
        credit.position,
        ["bottom-right", "bottom-left", "top-right", "top-left"],
        d.credit.position,
      ),
      offsetX: clampNumber(credit.offsetX, 0, 200, d.credit.offsetX),
      offsetY: clampNumber(credit.offsetY, 0, 200, d.credit.offsetY),
    },
    blobs: {
      enabled: blobs.enabled !== false,
      motion: pick(blobs.motion, ["float", "still"], d.blobs.motion),
      speed: clampNumber(blobs.speed, ...LIMITS.speed, d.blobs.speed),
      alphaA: clampNumber(blobs.alphaA, ...LIMITS.alpha, d.blobs.alphaA),
      alphaB: clampNumber(blobs.alphaB, ...LIMITS.alpha, d.blobs.alphaB),
    },
    ring: {
      enabled: ring.enabled !== false,
      style: pick(ring.style, ["band", "dots", "breathe"], d.ring.style),
      length: clampNumber(ring.length, ...LIMITS.length, d.ring.length),
      period: clampNumber(ring.period, ...LIMITS.period, d.ring.period),
      tail: ring.tail !== false,
      width: clampNumber(ring.width, 1, 8, d.ring.width),
    },
  };
}

/** True when the config still matches the shipped defaults. */
export function isDefault(config) {
  return JSON.stringify(normalizeConfig(config)) === JSON.stringify(DEFAULTS);
}
