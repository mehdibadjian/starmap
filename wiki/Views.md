# Views

Four views plus a persistent side panel. All share the same filtered set — switching views is re-rendering the same state, not querying differently.

```
Graph ──┬── click hub/leaf ──► drill ──► MAX_VISIBLE_REPOS cap ──► "+N more" ──► List
        └── click repo ─────────────────────────────────────────► RepoPanel
List    ◄── l key / "+N more"
Timeline · Graveyard · (search filters every one of them)
```

## Graph (`GraphView.tsx`, Canvas)

The primary surface. Progressive disclosure is the whole design — it never renders everything.

**What's visible** is a function of the current path only:

| Path | Nodes rendered |
|---|---|
| `[]` (cold) | `root` + 12 hubs. Nothing else. |
| `[hub]` | root, all hubs, and that hub's leaves. Other hubs stay drawn at full size — the spec's "other hubs dim and collapse" is not implemented. |
| `[hub, leaf]` | that leaf, its repos up to `MAX_VISIBLE_REPOS = 200`, and one overflow node if there are more. |

Associative edges render only between currently visible nodes (`visibleEdges = graph.edges.filter(e => visible.has(e.s) && visible.has(e.t))`), which is how the hairball is structurally impossible rather than merely hidden.

**Rendering.** DPR-aware canvas, redrawn on state change; a `requestAnimationFrame` loop runs continuously only while a search is active (that's what animates the pulse). Node fill comes from `colorForNode`, which walks `parent` up to the hub and indexes into the 12-colour palette — leaves and repos inherit their hub's colour. Node radius is a log scale: hub `12 + log(count)·2.5`, leaf `7 + log(count)·1.8`, repo `3 + log(stars)·1.3`. Repo nodes are meant to carry a **2px ring in the health colour**, so a sea of grey-ringed dots reads as decay without any text — that intent is real but currently broken, because the ring colour is assigned as a CSS variable and canvas ignores it ([Known Gaps](Known-Gaps.md)). Labels for non-repo nodes always draw; repo labels only above `zoom > 0.9`, so the canvas never becomes a word cloud.

**Camera.** State is `{x, y, zoom}`. Pointer drag pans (a 3px threshold distinguishes drag from click so releasing after a pan doesn't select), wheel zooms about the centre, `zoomBy` buttons, and `fitToView` computes a bounding box over the *focus* set (which narrows as you drill) and animates the camera there over 450 ms with an `easeInOutCubic`. `cameraRef` mirrors `camera` so the animation reads the current value synchronously instead of waiting for React's next commit — a real bug that was already caught and commented.

**Hit-testing** is a linear scan over visible nodes with `radius + 3` padding, plus the overflow circles. Cheap, correct at 200–250 nodes.

**Interactions.** Hover on a repo draws a Card tooltip (`nwo`, blurb clamped to two lines, lang / stars / forks / last push with health dot), clamped to the container edges. Click on a hub or leaf calls `onNavigate(path)`; click on a repo calls `onSelect(id)`, which opens the panel — note the spec says click-through belongs on the panel, not the node, and the code follows that. Click `+N` calls `onOpenList(leafPath)` to jump to the List view. A "related repos" checkbox toggles associative edges globally.

## List (`ListView.tsx`)

Dense table over the same filtered set. Filter chain: `repos → path-filtered → search-hit-filtered → language facet → health facet`. Columns are repo, lang, stars, health (colour dot with the state as its `title`), pushed, blurb. Row click selects a repo, opening the panel.

Facets are two `Select` dropdowns with an `all` option; the language facet's options are built from the currently searched set, so it never offers a language you can't see. `path` filtering matches `cat.some(c => c.startsWith("hub/"))` at depth 1 and `cat.includes("hub/leaf")` at depth 2, so a repo with multiple categories shows up under all of them in the list even though it lives under only one leaf in the graph.

## Timeline (`Timeline.tsx`)

Bars of stars per month, derived from `starred_at` across all shards — client-side aggregation over the loaded records, not `history.json`. Hover highlights a month and shows `YYYY-MM · N stars` in the header slot. Reveals phases of interest; useful for "I went through a Rust phase in 2024".

## Graveyard (`Graveyard.tsx`)

Archived + dead only, by reusing `ListView` with `repos.filter(r => r.health.state === "archived" || r.health.state === "dead")`, an empty path, and `searchHitIds={null}`. Note this means typing in the search box does nothing on this view — the header box is global but Graveyard ignores it, which reads as broken search if you try it here. The highest-value page in the app: it's the answer to "should I still be depending on this?"

## Repo panel (`RepoPanel.tsx`)

A Radix `Sheet` from the right, opened by any selection. The overlay is transparent by design so the canvas stays visible while the panel is open. `onPointerDownOutside` / `onInteractOutside` are prevented so clicking a node doesn't close-and-reopen behind it — the ✕, `Esc`, or selecting another repo are the ways to move.

Content: title, blurb, Open on GitHub, a 2-column stat grid (stars, forks, lang, license, health with dot, pushed, starred), categories as mono badges, topics as outline badges, homepage link. The bottom block is **related** — the panel filters `graph.edges` for associative edges incident on this repo, sorts by weight, and lists up to 20. Clicking a related repo calls the same `pickSearchResult` handler the search dropdown uses, so it navigates to that repo's leaf and re-selects. The panel *is* the graph's second navigation surface.
