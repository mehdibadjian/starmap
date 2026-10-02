# Frontend

`src/` is a Vite + React 18 + Tailwind SPA. No router, no data layer, no state library — everything comes from flat JSON and the app's state lives in the URL hash.

## File map

```
src/
  main.tsx                React root
  App.tsx                 loads data, wires keyboard + URL state, routes views
  components/
    GraphView.tsx         Canvas renderer, camera, hit-testing (largest file, 506 lines)
    ListView.tsx          Faceted table
    Timeline.tsx          Stars-per-month bars
    Graveyard.tsx         Archived + dead (wraps ListView)
    RepoPanel.tsx         Sheet sidebar with stats + related
    SearchBox.tsx         Dropdown suggestions
    ui/                   shadcn-flavoured primitives (badge, sheet, table, tabs, …)
  lib/
    data.ts               Fetch helpers, idle shard loading
    search.ts             MiniSearch loadJSON + query
    url.ts                Hash ↔ state
    types.ts              Frontend mirror of pipeline types
    palette.ts            12 categorical colours + health colours
    styles/
      index.css           Tailwind directives + base rules
      tokens.css          The theme. Everything else references it.
```

## Boot sequence

`App.tsx:46`:

```ts
useEffect(() => {
  fetchMeta().then(m => { setMeta(m); document.body.classList.remove/add(theme) })
  fetchGraph().then(setGraph)
  fetchSearchIndexRaw().then(loadSearchIndex).then(() => setSearchReady(true))
}, [])

useEffect(() => {
  if (!meta || reposLoadStarted.current) return
  loadAllRepos(meta.shard_count, batch => setRepos(prev => [...prev, ...batch]))
}, [meta])
```

Three things fetch concurrently on mount; shard loading waits for `meta.shard_count` and then dribbles batches into state during `requestIdleCallback`. Consequences:

- The graph and search box are usable before the list finishes loading.
- `reposById` fills incrementally, so a hub you click early might briefly show "no repos". Not usually visible; shards land during idle frames.
- Timeline and Graveyard read from `repos`, so both are empty at first paint and populate as shards arrive.

`document.body` gets the `dark` or `light` class from `meta.theme`, replacing the class already on `<body>` in `index.html` — that initial `class="dark"` in the HTML means the flash before `meta.json` resolves uses the dark palette.

## State and the URL

`src/lib/url.ts` encodes everything into the hash. No path segments — Pages does no server rewrites, so a path route would 404 on refresh.

```
#/<view?>/<hub?>/<leaf?>?q=<query>&r=<repoId>
```

Examples: `#/` graph cold; `#/devtools/cli?q=tui` drilled into a leaf with a query; `#/list/devtools/cli?r=28457823` the list view with a repo selected. `graph` is the default view and gets no prefix, so `#/devtools/cli` is a graph drill.

`App.tsx:36` seeds state from `parseHash(location.hash)` once, then `navigate()` writes back through `history.pushState` (so back/forward work) and a `hashchange` listener keeps state in sync when the user navigates the browser chrome. Anything viewable is shareable.

`selected` and `path` are repo IDs and taxonomy paths — strings that survive in a URL, which is why IDs (not indices) are the graph's node keys.

## Search is a graph input, not a page

`/` focuses the box; typing calls `search(query, 500)` on the rehydrated MiniSearch index, and the resulting ID set flows through three surfaces:

- Graph matching nodes grow a sine-wave pulse (`GraphView.tsx:278`).
- The header dropdown shows the top 8; picking one sets `path` to its first category and `selected` to the repo, so the camera flies to it and the panel opens.
- List view filters rows to the hit set.

`App.tsx:105` auto-expands the graph to the top hit as a side effect of the search-result set changing. That's what "search drives the graph" means concretely — it isn't a separate tab.

## Keyboard

Handled at the window level in `App.tsx`, with an `isTypingTarget` guard so keys pressed in an input don't also drive the app.

| Key | Action |
|---|---|
| `/` | Focus search |
| `Esc` | Close panel, else walk up one breadcrumb level; inside an input it just blurs |
| `l` | Toggle list ↔ graph |
| `Enter` | Open the selected repo on GitHub |
| `f` | Fit to view (bound in `GraphView`) |

## Perf budget

The spec's targets are under 2 s to interactive on 4G and under 3 MB initial payload. Mechanisms: relative `./data/*` fetches, `base: './'` so the app shell is cacheable, graph + search index first, shards in idle, and Canvas rather than SVG for the graph (SVG collapses past roughly 2k nodes).

Nothing is code-split — the whole app is one bundle. At this size that's the right call; if you add heavy dependencies, revisit it.
