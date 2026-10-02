# Graph Construction

The graph is the presentation layer, not a datastore. It is built entirely in CI (`pipeline/graph.ts`) and shipped as coordinates in `data/graph.json`.

## Nodes

| Kind | Count | ID form | Notes |
|---|---|---|---|
| `root` | 1 | `root` | the account, labelled with `login` |
| `hub` | 12 | `hub:devtools` | one per taxonomy root, `count` = repos under it |
| `leaf` | 55 | `leaf:devtools/cli` | one per taxonomy leaf, `count` = repos in it |
| `repo` | 1 per star | `repo:28457823` | parented to its **primary** leaf (`cat[0]`, falling back to `misc/other`) |

A repo with three categories still appears once. `cat[1]` and `cat[2]` are visible in the panel and searchable, but the graph spine uses only the primary leaf — otherwise the structural edges would duplicate nodes.

Hub and leaf counts are computed by `rootOfLeaf`, which maps a leaf ID back to its root; the hub's count is "repos with at least one category in this root".

## Edges

**Structural** (`kind: "struct"`) form the navigation spine: `root → hub → leaf → repo`. Edges to empty hubs and leaves are skipped, so the cold-load view contains only categories you actually have stars in.

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

The simulation (`graph.ts:167`) uses: link distance 60 / strength 0.8 for structural edges and 40 / 0.1 for associative ones (related repos attract without distorting the spine), many-body charge `-40`, centering at the origin, and collision radii of 30 / 20 / 12 / 4 for root / hub / leaf / repo. Coordinates are rounded to one decimal.

## Position seeding

`cache/positions.json` stores the previous run's `{nodeId: {x, y}}`. Every node asks `seed(id, fallbackX, fallbackY)` first, so a nightly run starts from last night's answer: hubs and leaves keep their exact places and new repos appear near their leaf (offset from the parent's position). Only the very first run is a genuine cold layout, with hubs arranged on a 300-unit ring.

The file is rewritten from `extractPositions(graph)` each run and committed back, which is what makes incremental layout work across CI runs that share no state except git.

Practical consequence: **if you delete `cache/positions.json`, the whole map reshuffles on the next run** — a valid "reset the layout" escape hatch.

## Reading the file

`src/components/GraphView.tsx` builds `nodesById` and `childrenByParent` maps from this JSON once, then derives a visible subset from the current path. It never runs physics in the browser; `x`/`y` are used as-is. See [Views](Views.md).
