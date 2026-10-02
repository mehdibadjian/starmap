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
```

`tailwind.config.js` maps shadcn/ui's semantic aliases onto the tokens, and `tokens.css` defines the same aliases inside `.dark` / `.light`. There is exactly one place to change each colour.

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

`colorForHubIndex(index)` is modulo-based, so a taxonomy with more than 12 roots reuses colours rather than breaking. `colorForNode` in the graph walks a node's `parent` chain up to its hub and indexes by hub order, which is how leaves and repos inherit the right colour for free.

`healthColor(state)` returns `var(--health-*)` strings rather than hex, so canvas strokes and DOM dots follow the active theme from the same tokens.

## Fonts

`--font-mono: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace` and `--font-sans: "IBM Plex Sans", system-ui, sans-serif`.

**No webfont is loaded.** There is no `<link>` in `index.html` and no `@font-face`, so IBM Plex renders only if the visitor has it installed; everyone else silently gets `SFMono-Regular`/Consolas and `system-ui`. That is a defensible choice for a zero-third-party-request static site, but if the typographic look matters, add the fonts to `public/` and `@font-face` them — don't reach for a CDN, which reintroduces an external dependency.

Mono is used for identifiers everywhere (`nwo`, category badges, counts, timestamps, the header title); sans for prose (blurbs, empty states).

## Applying a theme

`theme: dark | light` in `config.yml` reaches the browser as `meta.json.theme`, and `App.tsx` swaps the class on `document.body`:

```ts
document.body.classList.remove("dark", "light");
document.body.classList.add(m.theme);
```

`index.html` ships `<body class="dark">` so the first paint before `meta.json` arrives is already dark. `tailwind.config.js` uses `darkMode: ["class"]`.

To add a third theme: define a `.yourtheme` block in `tokens.css`, allow the value in `Config["theme"]` and `MetaJson["theme"]` in both `pipeline/types.ts` and `src/lib/types.ts`, and validate it in `pipeline/config.ts`.

## Canvas gotcha

Canvas 2D does not resolve `var()` in `fillStyle`/`strokeStyle` — the assignment is silently ignored and the property keeps its previous valid value. `GraphView` currently assigns `"var(--…)"` strings in several places (`colorForNode` for the root, `healthColor(state)` for the repo rings, the accent selection and focus-edge strokes, the `+N` circle), so those specific elements do not render in their intended colours. `healthColor` returning `var(--health-*)` is correct for DOM use and wrong for canvas; only the canvas call sites are affected.

The file already handles it correctly at `GraphView.tsx:248` and `:304` — `getComputedStyle(document.documentElement).getPropertyValue("--color-bg")` with a hex fallback — which is the pattern to follow. Details and verified pixel values in [Known Gaps](Known-Gaps.md).
