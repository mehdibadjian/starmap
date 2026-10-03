# Graph Construction

The graph is the presentation layer, not a datastore. It is built entirely in CI (`pipeline/graph.ts`) and shipped as coordinates in `data/graph.json`.

## Nodes

| Kind | Count | ID form | Notes |
|---|---|---|---|
| `root` | 1 | `root` | the account, labelled with `login` |
| `hub` | one per **populated** root | `hub:devtools` | `count` = repos with at least one category in this root |
| `leaf` | one per **attached** leaf | `leaf:devtools/cli` | `count` = repos in it |
| `repo` | 1 per star | `repo:28457823` | parented to its **primary** leaf (`cat[0]`, falling back to `misc/other`) |

A repo with three categories still appears once. `cat[1]` and `cat[2]` are visible in the panel and searchable, but the graph spine uses only the primary leaf — otherwise the structural edges would duplicate nodes.

Hub and leaf counts are computed by `rootOfLeaf`, which maps a leaf ID back to its root; the hub's count is "repos with at least one category in this root".

**Emptiness is pruned, and it is pruned on attachment.** The taxonomy is a fixed tree, so most forks leave several leaves with nothing starred in them. Emitting those leaves produces a tappable dot that navigates to a genuinely empty view — which reads as a broken map, not as an unused category. So a leaf becomes a node only if `attachedOf(leafId) > 0` (`pipeline/graph.ts:118`), counting repos whose `cat[0]` *is* that leaf, and a root is emitted only if at least one of its leaves survives.

The subtle part is *which* count that test uses. Pruning on the displayed count (`repos.filter(r => r.cat.includes(leaf))`) would leave the bug in place: a category that is only ever anybody's second or third category shows a non-zero count yet has no repos attached to it, so it would still be emitted and still be empty. Counts are deliberately still computed from `cat.includes` — a leaf's number is "repos filed here, however loosely" — while reachability uses `cat[0]`. `tests/graph.test.ts` pins both halves, and `npm run smoke` asserts the emitted leaf set is strictly smaller than the taxonomy's, on a dataset that has empty leaves by construction.

## Edges

**Structural** (`kind: "struct"`) form the navigation spine: `root → hub → leaf → repo`. Empty hubs and leaves have no nodes at all rather than nodes with no edges — see the pruning rule above — so the spine only ever connects places a reader can actually land.

**Associative** (`kind: "assoc"`) connect repo ↔ repo by similarity:

```
weight = jaccard(topics_i, topics_j) + 0.1 (same owner) + 0.1 (same language),  capped at 1
```

Two nodes only become candidates if they share a topic or an owner, and topic lists longer than `CANDIDATE_LIST_CAP` (400) are skipped — a `github` or `typescript` tag shared by half your stars would otherwise generate millions of pairs. Then:

- drop anything below `ASSOC_THRESHOLD = 0.15`
- keep the top `ASSOC_TOP_K = 6` per node
- dedupe so each unordered pair is emitted once

Pruning is not cosmetic. Unpruned, a few thousand nodes render as an unreadable hairball, and the client would receive edges it could not draw. Weights are rounded to two decimals to keep the file small.

## Layout is precomputed

`d3-force` runs headless for `TICKS = 300` and the settled `x`/`y` are written to the JSON. Two reasons this is non-negotiable:

1. The client paints immediately instead of spending seconds settling physics.
2. Positions stay stable between visits, so you learn the map. A graph that re-jitters on every load is not navigation.

The simulation (`graph.ts:190`) uses: link distance 60 / strength 0.8 for structural edges and 40 / 0.1 for associative ones (related repos attract without distorting the spine), many-body charge `-40`, centering at the origin, and collision radii of 30 / 20 / 12 / 4 for root / hub / leaf / repo. Coordinates are rounded to one decimal.

## Position seeding

`cache/positions.json` stores the previous run's `{nodeId: {x, y}}`. Every node asks `seed(id, fallbackX, fallbackY)` first, so a nightly run starts from last night's answer: hubs and leaves keep their exact places and new repos appear near their leaf (offset from the parent's position). Only the very first run is a genuine cold layout, with hubs arranged on a 300-unit ring.

The file is rewritten from `extractPositions(graph)` each run and committed back, which is what makes incremental layout work across CI runs that share no state except git.

Practical consequence: **if you delete `cache/positions.json`, the whole map reshuffles on the next run** — a valid "reset the layout" escape hatch.

## Reading the file

`src/components/GraphView.tsx` builds `nodesById` and `childrenByParent` maps from this JSON once, then derives a visible subset from the current path. It never runs physics in the browser; `x`/`y` are used as-is.

Two derived behaviours depend on this file's shape, and both were wrong once:

- **Drilling into a hub shows repos, not just its leaves.** A hub is a group of repos, so the hub view collects the repos under every leaf of that hub, ranks them by stars, and draws up to `MAX_VISIBLE_REPOS_COARSE` (60) on touch / `_FINE` (200) on a cursor, with one `+N` circle parked at the mean position of what each leaf hides. Rendering only the leaf dots made a 383-repo category look exactly like an empty one.
- **A path naming a node that isn't in the file says so.** Because empty categories are pruned, a stale bookmark or hand-typed hash can resolve to `leaf:ai-ml/dead-name` with no node behind it. `pathMissing` compares the wanted node id against `nodesById` and draws a "Nothing in this category" card with a back button instead of a blank canvas.

See [Views](Views.md).
