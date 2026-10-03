# Theming and Tokens

Aesthetic direction: dense and typographic, not card-soup. Monospace for identifiers, a real typeface for prose, one accent colour, dark by default.

## One file to edit

`src/styles/tokens.css` is the single source of theme truth. `src/styles/index.css` only adds the Tailwind directives and three base rules, and every Tailwind colour in `tailwind.config.js` resolves to a CSS variable. Restyle the site without touching a component by changing token values.

```
tokens.css  →  CSS custom properties (--color-*, --health-*, --font-*)
   ↓ (var())
tailwind.config.js  →  background, foreground, card, primary, muted, accent, border, ring, link…
   ↓ (utility classes)
components + ui/primitives
   ↘ (getComputedStyle → literals)  canvas: src/lib/canvasTheme.ts
```

`tailwind.config.js` maps shadcn/ui's semantic aliases onto the tokens, and `tokens.css` defines the same aliases inside `.dark` / `.light`. There is exactly one place to change each colour.

**Two families of names, and they are not interchangeable.** The design tokens are `--color-*`; the shadcn aliases are bare (`--accent`, `--border`, `--ring`). `--accent` is `var(--color-surface-2)` — a hover surface — *not* the terracotta brand colour, which is `--color-accent`. Anything that resolves a token programmatically must name it explicitly. `canvasTheme.ts` keeps a literal `TOKENS` map for exactly this reason, and deriving a name from a field (`--${key}`) silently produces the wrong colour or none at all.

## Palette

| Token | Dark | Light |
|---|---|---|
| `--color-bg` | `#1e1e1e` | `#f5f4f1` |
| `--color-surface` / `-2` | `#252526` / `#2d2d2d` | `#ffffff` / `#ece9e3` |
| `--color-border` | `#3a3a3a` | `#ddd8cf` |
| `--color-text` / `-dim` | `#d4d4d4` / `#8a8a8a` | `#2a2724` / `#74706a` |
| `--color-accent` | `#cc785c` | `#b8603f` |
| `--color-link` | `#5ba0e0` | `#2b6cb0` |

The VS Code-dark-adjacent neutrals with a single terracotta accent are deliberate: the graph needs colour to encode category, so the chrome must not compete with it.

Health colours are a five-step ramp from green to grey, so decay reads as a fade rather than an alarm:

`active` `#6bb85a` → `slowing` `#d3a44b` → `stale` `#d97a3f` → `dead` `#6e6e6e` → `archived` `#4a4a4a`.

## Category colours

`src/lib/palette.ts` holds `CATEGORY_PALETTE`: twelve desaturated, low-chroma fills, one per taxonomy root in taxonomy order (steel blue for `ai-ml`, tan for `devtools`, olive for `web`, … plum for `misc`). Comments name the intended root, so reordering `taxonomy.json` shifts the colours with it — keep them aligned if you add or reorder roots.

`colorForHubIndex(index)` is modulo-based, so a taxonomy with more than 12 roots reuses colours rather than breaking. The graph resolves a node's hub by walking `parent`, then indexes by hub order, which is how leaves and repos inherit the right colour for free.

`healthColor(state)` returns `var(--health-*)` strings rather than hex. That is correct for DOM use (`style={{ background: healthColor(s) }}`, the legend dots, the list's health column) and **wrong for canvas**, which is why the graph doesn't call it — it reads `theme.health[state]` from the resolved palette instead.

## Fonts

`--font-mono: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace` and `--font-sans: "IBM Plex Sans", system-ui, sans-serif`.

**The webfonts ship in the repo.** `src/styles/fonts.css` declares three `@font-face` rules and `src/assets/fonts/` holds the files: IBM Plex Sans as one variable font covering 400–600, and Plex Mono at the two weights actually used — about 74 kB together, latin `unicode-range` subsets only. There is deliberately no `<link>` to Google's CDN: the site's rule is no runtime requests to another origin, and a fork shouldn't inherit a third-party dependency or a render-blocking fetch for a typeface. `fonts.css` is imported from `index.css`, so Vite hashes the woff2 files into `assets/` and the paths rewrite themselves — which is why the `url()`s are relative (`../assets/fonts/…`) rather than `/fonts/…`: the site deploys under a project-page subpath with `base: "./"`, and an absolute path 404s. `font-display: swap` means a slow first paint shows the system fallback rather than invisible text.

The `npm run smoke` suite asserts this rather than trusting it: three declared `FontFace` objects with an IBM Plex family, and each one `loaded`/`fetched` before the shell checks pass. A `@font-face` that points at a path Vite didn't emit is exactly the kind of defect a static-site rule set hides until someone looks at the deployed page.

Mono is used for identifiers everywhere (`nwo`, category badges, counts, timestamps, the header title); sans for prose (blurbs, empty states).

## Applying a theme

`theme: dark | light` in `config.yml` reaches the browser as `meta.json.theme`, and `App.tsx:54` swaps the class on **`document.documentElement`**:

```ts
const root = document.documentElement;
root.classList.remove("dark", "light");
root.classList.add(m.theme);
```

`<html>`, not `<body>`, for two reasons. The token blocks are `.dark { … }` / `.light { … }`, so a custom property is only inherited by everything under the element that carries the class — and canvas reads them with `getComputedStyle(document.documentElement)`, which sees nothing set on `<body>`. Applying the class to `<body>` meant the graph silently used the fallback literals in `canvasTheme.ts` instead of the fork's palette.

`index.html` puts `class="dark"` on `<html>` and runs a small inline script first:

```html
<script>
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    document.documentElement.classList.replace("dark", "light");
  }
</script>
```

So a light-preferring phone gets a light first frame rather than a dark flash, and `meta.json`'s explicit choice still wins once it arrives. `tailwind.config.js` uses `darkMode: ["class"]`.

To add a third theme: define a `.yourtheme` block in `tokens.css`, add its token names to `TOKENS`/`FALLBACK` in `src/lib/canvasTheme.ts`, allow the value in `Config["theme"]` (`pipeline/types.ts`) and in `MetaJson["theme"]` (`shared/dataSchema.ts`, which both sides of the app import), and validate it in `pipeline/config.ts`.

## Canvas: the gotcha that shaped this

Canvas 2D parses `fillStyle`, `strokeStyle`, and `font` as CSS **values**. A custom property is not a value. `ctx.fillStyle = "var(--color-accent)"` throws nothing, is silently rejected, and leaves the property at whatever it last validly was — which produces very specific, very confusing symptoms depending on draw order (a root node painted in the background colour is simply invisible; health rings take the previous edge stroke and look uniformly grey). Verified again in headless Chromium 152, including for `font`:

```js
const c = document.createElement("canvas").getContext("2d");
const before = c.font;
c.font = "600 12px var(--font-sans)";
c.font === before;                    // true — the assignment did nothing
c.font = '600 12px "IBM Plex Sans", system-ui, sans-serif';   // works
```

So `src/lib/canvasTheme.ts` resolves the whole palette once per draw into `{ bg, surface, border, text, textDim, accent, health{}, fontSans, fontMono }` with literal values, and `GraphView` never touches a `var()` string. The fallbacks mirror the `.dark` block, which is what renders before `meta.json` has applied a theme. **If you add a token the canvas needs, add it to the `TOKENS` map — do not derive the name.**

**Repainting on theme change.** The canvas only redraws when a React dependency changes, and a theme swap is a class change on an element React doesn't own. `GraphView`'s `themeTick` (`:95`) is bumped by a `MutationObserver` on `<html>`'s class, a `prefers-color-scheme` change listener, and `window.resize` — the last of which was its own bug: rotating a phone or collapsing the URL bar changed the container size without ever triggering a paint, so the canvas kept the old backing-store dimensions and stretched.

`tests/themeTokens.test.ts` guards all of this without a browser: it parses the blocks out of `tokens.css`, stubs `getComputedStyle`, and asserts `readCanvasTheme()` returns exactly the expected literals in each theme — including that `accent` is `--color-accent`. Renaming a token in CSS without updating the map fails the suite.
