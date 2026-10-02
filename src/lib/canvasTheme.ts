/**
 * Canvas 2D parses `fillStyle`/`strokeStyle`/`font` as CSS *values*, and a
 * custom property is not a value: `ctx.fillStyle = "var(--color-accent)"`
 * throws nothing, is silently rejected, and leaves the previous colour in
 * place. The DOM is fine with `var()`; only canvas needs the resolved literal.
 *
 * So the graph reads its palette from the theme once per frame and works in
 * hex thereafter. Fallbacks mirror the `.dark` block in tokens.css, which is
 * what renders before `meta.json` has applied a theme.
 */
export interface CanvasTheme {
  bg: string;
  surface: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  health: Record<string, string>;
  fontSans: string;
  fontMono: string;
}

/**
 * Token names in tokens.css. These have to be spelled out: `--bg` does not
 * exist (it is `--color-bg`), and `--accent` *does* exist but as the shadcn
 * hover-surface alias rather than the brand colour — a lookup derived from the
 * field names would silently read the wrong variable, or none at all.
 */
const TOKENS = {
  bg: "--color-bg",
  surface: "--color-surface",
  border: "--color-border",
  text: "--color-text",
  textDim: "--color-text-dim",
  accent: "--color-accent",
  fontSans: "--font-sans",
  fontMono: "--font-mono",
} as const;

/** Health states are namespaced as `--health-active` and friends. */
const HEALTH_PREFIX = "--health-";

/**
 * Fallbacks mirror the `.dark` block in tokens.css, which is the class index.html
 * puts on <html> before meta.json has a chance to apply the fork's preference.
 */
const FALLBACK: CanvasTheme = {
  bg: "#1e1e1e",
  surface: "#252526",
  border: "#3a3a3a",
  text: "#d4d4d4",
  textDim: "#8a8a8a",
  accent: "#cc785c",
  health: {
    active: "#6bb85a",
    slowing: "#d3a44b",
    stale: "#d97a3f",
    dead: "#6e6e6e",
    archived: "#4a4a4a",
  },
  fontSans: '"IBM Plex Sans", system-ui, sans-serif',
  fontMono: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
};

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name);
  return value.trim() || fallback;
}

export function readCanvasTheme(): CanvasTheme {
  const styles = getComputedStyle(document.documentElement);
  const health: Record<string, string> = {};
  for (const [state, fallback] of Object.entries(FALLBACK.health)) {
    health[state] = readVar(styles, `${HEALTH_PREFIX}${state}`, fallback);
  }
  return {
    bg: readVar(styles, TOKENS.bg, FALLBACK.bg),
    surface: readVar(styles, TOKENS.surface, FALLBACK.surface),
    border: readVar(styles, TOKENS.border, FALLBACK.border),
    text: readVar(styles, TOKENS.text, FALLBACK.text),
    textDim: readVar(styles, TOKENS.textDim, FALLBACK.textDim),
    accent: readVar(styles, TOKENS.accent, FALLBACK.accent),
    health,
    fontSans: readVar(styles, TOKENS.fontSans, FALLBACK.fontSans),
    fontMono: readVar(styles, TOKENS.fontMono, FALLBACK.fontMono),
  };
}
