# Frontend

`src/` is a Vite + React 18 + Tailwind SPA. No router, no data layer, no state library — everything comes from flat JSON and the app's state lives in the URL hash.

## File map

```
shared/
  searchSchema.ts         MiniSearch field list + query options — the build↔browser contract
  dataSchema.ts           Every shape in the published JSON — the same contract for the data itself
src/
  main.tsx                React root
  App.tsx                 loads data, wires keyboard + URL state, routes views, error/degraded states
  assets/fonts/           IBM Plex woff2 subsets, self-hosted
  components/
    GraphView.tsx         Canvas renderer, camera, pointer + keyboard input, legend (largest file, 892 lines)
    ListView.tsx          Faceted, sortable, windowed table
    Timeline.tsx          Stars-per-month bars
    Graveyard.tsx         Archived + dead (wraps ListView)
    RepoPanel.tsx         Sheet sidebar with stats + related
    SearchBox.tsx         ARIA combobox dropdown
    ui/                   shadcn-flavoured primitives (badge, sheet, table, tabs, …)
  lib/
    data.ts               Fetch helpers, shard-row guard, idle shard loading
    search.ts             MiniSearch loadJSON + query
    canvasTheme.ts        Resolves theme tokens to literals for canvas
    metaBadges.ts         Header badge rules derived from meta.json (uncategorised rate)
    url.ts                Hash ↔ state (takes the device's home view as an argument)
    pointer.ts            `matchMedia("(pointer: coarse)")`, the one phone/desktop signal
    viewPref.ts           Landing view by device, plus the stored choice in localStorage
    types.ts              Re-exports @shared/dataSchema + the frontend-only view/state types
    palette.ts            12 categorical colours + health `var()` strings (DOM only)
    styles/
      index.css           Tailwind directives + base rules
      fonts.css           @font-face for the self-hosted subsets
      tokens.css          The theme. Everything else references it.
tests/
  *.test.ts               node:test suites, run through tsx — no test framework dependency
  browser/                CDP smoke suite (`smoke.mjs`), driver (`cdp.mjs`), fixtures (`fixture.mjs`)
```

`shared/` exists because some contracts span both halves of the repo. A serialized MiniSearch index carries its field-name → field-id map in the payload, so a client that rehydrates with a different field list doesn't error — it silently stops matching on the fields only it knows about. That was the most consequential bug in this codebase; sharing the list makes the divergence unrepresentable rather than merely unlikely. `dataSchema.ts` is the same treatment for the published JSON: `src/lib/types.ts` and `pipeline/types.ts` used to keep hand-written copies of `RepoRecord`, `MetaJson`, and `GraphData`, which agreed only by discipline. See [Output Data Format](Output-Data-Format.md).

## Boot sequence

`App.tsx:58`:

```ts
useEffect(() => {
  fetchMeta()
    .then((m) => { setMeta(m); /* theme class onto <html> */ })
    .catch((err) => setLoadError(`Could not load data/meta.json — ${err.message}`));
  fetchGraph().then(setGraph).catch((err) => setLoadError(…));
  fetchSearchIndexRaw().then(loadSearchIndex).then(() => setSearchReady(true))
    .catch(() => setSearchUnavailable(true));
}, []);

useEffect(() => {
  if (!meta || reposLoadStarted.current) return;
  loadAllRepos(meta.shard_count, (batch) => setRepos((prev) => [...prev, ...batch]));
}, [meta]);
```

Three things fetch concurrently on mount; shard loading waits for `meta.shard_count` and then dribbles batches into state during `requestIdleCallback`. Consequences:

- The graph and search box are usable before the list finishes loading.
- `reposById` fills incrementally, so a hub you click early might briefly show "no repos". Not usually visible; shards land during idle frames.
- Timeline and Graveyard read from `repos`, so both are empty at first paint and populate as shards arrive.

The two failure paths are deliberately different: a missing `meta.json`/`graph.json` is fatal and renders a recovery screen, a missing `search.json` is not and renders a `search off` badge. Details in [Views](Views.md).

The header badges that report *data quality* rather than load failure all come from `meta.json`, and `src/lib/metaBadges.ts` owns their rules. `rules-only` appears when `meta.llm_degraded`; `N% uncategorised` appears only at or above `UNSORTED_TARGET_PCT` (10, the SPEC's M3 target) and its tooltip names the two fixes. `App.tsx:179` computes the badge once and the JSX tests that result, so the condition and the label cannot drift apart — the alternative was the header deciding to show something and the text deciding what it said.

`document.documentElement` gets the `dark` or `light` class from `meta.theme` — `<html>`, not `<body>`, because the tokens are defined on `.dark`/`.light` blocks and `getComputedStyle(document.documentElement)` (which canvas uses) only sees variables inherited down from the root element. `index.html` sets `class="dark"` on `<html>` and runs a two-line inline script that swaps it to `light` when the system prefers light, so the first frame is already in the right palette before `meta.json` arrives. [Theming and Tokens](Theming-and-Tokens.md).

## Data boundaries

`src/lib/data.ts` treats published JSON as untrusted input, because it is generated by a job that can produce a bad row without failing. `isUsableRepo` (`:32`) filters every shard: a record must have a numeric `id`, a string `nwo`, string-array `cat`/`topics`/`tags`, and a `health.state`. Rows that don't match are dropped rather than passed on.

This exists because one `cat: [null]` throws inside `ListView`'s filter and blanks the entire SPA — no error screen, since React only catches what happens during render of a boundary it knows about. Dropping the row costs one entry from the list; not dropping it costs the site.

## State and the URL

`src/lib/url.ts` encodes everything into the hash. No path segments — Pages does no server rewrites, so a path route would 404 on refresh.

```
#/<view?>/<hub?>/<leaf?>?q=<query>&r=<repoId>
```

Examples: `#/` home (graph on a cursor, List on a touch device — see [Views](Views.md#which-view-you-land-on)); `#/devtools/cli?q=tui` drilled into a leaf with a query; `#/list/devtools/cli?r=28457823` the list view with a repo selected. `graph` is the prefix-less view, so `#/devtools/cli` is a graph drill — which is also why a phone's Graph tab keeps the URL at `#/` rather than writing a `graph` prefix that could be mistaken for a category of that name.

`App.tsx` seeds state from `parseHash(location.hash, homeView())` — the second argument is what makes a bare `#/` device-relative — then `navigate()` writes back through `history.pushState` (so back/forward work) and a `hashchange` listener keeps state in sync when the user navigates the browser chrome. Anything viewable is shareable — which is why deep-link state is covered by a round-trip test, and why a drill never resolves to anything but the graph.

`selected` and `path` are repo IDs and taxonomy paths — strings that survive in a URL, which is why IDs (not indices) are the graph's node keys.

## Search is a graph input, not a page

`/` focuses the box; typing calls `search(query, 500)` on the rehydrated MiniSearch index, and the resulting ID set flows through three surfaces:

- Graph matching nodes grow a sine-wave pulse and a slightly larger radius (`GraphView.tsx:411`).
- The header dropdown shows the top 8 plus a `+N more` count from the total hit set; picking one sets `path` to its first category and `selected` to the repo, so the camera flies to it and the panel opens.
- List view filters rows to the hit set.

`App.tsx:141` auto-expands the graph to the top hit as a side effect of the search-result set changing. That's what "search drives the graph" means concretely — it isn't a separate tab.

`SearchBox` is a proper ARIA combobox rather than a styled input: `role="combobox"` with `aria-expanded`/`aria-controls`/`aria-autocomplete`/`aria-activedescendant` on the input, `role="listbox"` with `role="option"` rows, arrow keys moving a wrap-around highlight, Enter accepting it, Escape closing it, and `onMouseDown`+`preventDefault` on rows so a click wins the race against blur. It is deliberately **not** `role="listbox"` on the container with keyboard handling split across components — half a combobox is worse for a screen reader than none, because the announced state lies.

## Keyboard

Handled at the window level in `App.tsx:149`, with an `isTypingTarget` guard so keys pressed in an input don't also drive the app.

| Key | Action |
|---|---|
| `/` | Focus search |
| `Esc` | Close panel, else walk up one breadcrumb level; inside an input it just blurs |
| `l` | Toggle list ↔ graph (via `selectView`, so it also records the preference) |
| `Enter` | Open the selected repo on GitHub |

The canvas owns its own keys — arrows, Enter/Space, `+`, `-`, `0` — on the element, not at window level; see [Views](Views.md). Where the two overlap on `Enter`, the canvas marks the event and the window handler stands down. `SPEC.md`'s `f`-to-fit became `0`; `f` is not bound.

## Mobile

Phone-first, not desktop-with-shrinking. The concrete rules, each with a reason:

- `viewport-fit=cover` plus `h-[100dvh]` so the layout respects the notch and a collapsing URL bar.
- The search input's font size is `text-base` (16px) below `sm`. iOS Safari zooms the whole page on focusing any input under 16px, and the app has no way to dismiss that. It is the one place where the type scale is intentionally not uniform with the desktop chrome.
- Tap targets are 24px minimum for chrome, 32px in the breadcrumb, 40px for the zoom controls, 44px for the panel's close button.
- Tabs collapse to icons below `sm`, with `aria-label` carrying the name — a 390px header cannot fit four labels and a search box.
- The header uses flex `order` so the phone wraps to two rows while the desktop reading order is unchanged.
- The graph's touch behaviour (pinch, drag thresholds, collapsed legend, no hover) is documented in [Views](Views.md).

`prefers-reduced-motion` is honoured in the canvas camera and search pulse.

## Perf budget

The spec's targets are under 2 s to interactive on 4G and under 3 MB initial payload. Mechanisms: relative `./data/*` fetches, `base: './'` so the app shell is cacheable, graph + search index first, shards in idle, Canvas rather than SVG for the graph (SVG collapses past roughly 2k nodes), and a windowed list so a large star set costs a constant number of DOM rows.

Nothing is code-split — the whole app is one bundle, currently ~352 kB raw / ~114 kB gzipped, with the three woff2 subsets adding ~74 kB of their own (they are fetched in parallel and `display: swap`, so they are not render-blocking). At this size that's the right call; if you add heavy dependencies, revisit it.
