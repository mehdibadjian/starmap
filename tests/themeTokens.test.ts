import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The graph canvas reads theme tokens through `getComputedStyle`, so the token
 * names in canvasTheme.ts and the definitions in tokens.css have to agree — and
 * nothing in TypeScript checks a string. `--bg` versus `--color-bg` resolves to
 * an empty string, which falls back silently and paints the dark palette on a
 * light theme. This test drives the real module against the real stylesheet.
 */
const TOKENS_PATH = new URL("../src/styles/tokens.css", import.meta.url);

/** Flatten one selector block, resolving single-level `var()` aliases. */
function block(names: string[]): Record<string, string> {
  const css = readFileSync(TOKENS_PATH, "utf-8");
  const out: Record<string, string> = {};
  for (const name of names) {
    const match = css.match(new RegExp(`\\${name}\\s*\\{([\\s\\S]*?)\\}`));
    assert.ok(match, `tokens.css has no "${name}" block`);
    for (const line of match[1].split("\n")) {
      const decl = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/);
      if (decl) out[decl[1]] = decl[2].trim();
    }
  }
  for (const [key, value] of Object.entries(out)) {
    const alias = value.match(/^var\((--[a-z0-9-]+)\)$/);
    if (alias && out[alias[1]]) out[key] = out[alias[1]];
  }
  return out;
}

test("canvas tokens resolve against the real stylesheet, in light theme", async () => {
  const styles = block([":root", ".light"]);
  const read = (name: string) => styles[name] ?? "";

  installDomStub(read);
  const { readCanvasTheme } = await import("../src/lib/canvasTheme.ts");
  const theme = readCanvasTheme();

  // Every one of these would be a `.dark` value if a token name drifted.
  assert.equal(theme.bg, "#f5f4f1");
  assert.equal(theme.surface, "#ffffff");
  assert.equal(theme.border, "#ddd8cf");
  assert.equal(theme.text, "#2a2724");
  assert.equal(theme.textDim, "#74706a");
  assert.equal(theme.accent, "#b8603f");
  assert.equal(theme.health.active, "#4d7a3a");
  assert.equal(theme.health.archived, "#c7c2b8");
  assert.match(theme.fontSans, /IBM Plex Sans/);
});

test("the brand accent is --color-accent, not the shadcn --accent alias", async () => {
  const styles = block([":root", ".dark"]);
  assert.notEqual(styles["--accent"], styles["--color-accent"], "the aliases really do differ");

  installDomStub((name) => styles[name] ?? "");
  const { readCanvasTheme } = await import("../src/lib/canvasTheme.ts");
  assert.equal(readCanvasTheme().accent, styles["--color-accent"]);
});

/** The canvas needs *some* palette before styles load, so nothing may be blank. */
test("unresolved tokens fall back instead of handing canvas an empty string", async () => {
  installDomStub(() => "");
  const { readCanvasTheme } = await import("../src/lib/canvasTheme.ts");
  const theme = readCanvasTheme();
  assert.equal(theme.bg, "#1e1e1e");
  const scalars: Record<string, string> = {
    bg: theme.bg,
    surface: theme.surface,
    border: theme.border,
    text: theme.text,
    textDim: theme.textDim,
    accent: theme.accent,
    fontSans: theme.fontSans,
    fontMono: theme.fontMono,
  };
  for (const [key, value] of Object.entries(scalars)) {
    assert.ok(value.length > 0, `${key} must not be empty`);
  }
  for (const [state, color] of Object.entries(theme.health)) {
    assert.ok(color.length > 0, `health colour "${state}" must not be empty`);
  }
});

function installDomStub(getPropertyValue: (name: string) => string): void {
  const element = {};
  (globalThis as { document?: unknown }).document = { documentElement: element };
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({ getPropertyValue });
}
