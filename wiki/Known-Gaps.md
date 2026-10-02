# Known Gaps

The difference between what the code does, what `SPEC.md` describes, and what a reviewer would want. Verified against the current tree; each item says how it was checked.

## Bugs

### 1. Topics and tags are not searchable

**Severity: high. Affects the core feature.**

`pipeline/buildIndex.ts` indexes fields `["nwo", "desc", "blurb", "topicsText", "tagsText"]`. `src/lib/search.ts` rehydrates with `fields: ["nwo", "desc", "blurb", "topics", "tags"]`.

Why that breaks: `toJSON()` writes the build-time `fieldIds` map into the payload, and `instantiateMiniSearch` restores `miniSearch._fieldIds = fieldIds` from it — the client's own `fields` option is *not* used to rebuild that map. At query time `executeQuerySpec` builds `boosts` from `this._options.fields` (`index.js:1611`) and `termResults` does `const fieldId = this._fieldIds[field]` (`index.js:1713`). For `"topics"` and `"tags"` that lookup is `undefined`, `fieldTermData.get(undefined)` misses, and the loop `continue`s — so those two fields can never produce a match, no matter what is in the index.

Verified against `minisearch@7.2.0` (the version in `package-lock.json`), with `zebra` present only as a topic and `quokka` only as a tag:

```
freshly built index            search('zebra') → [1]   search('quokka') → [1]
rehydrated with same options   search('zebra') → [1]   search('quokka') → [1]
rehydrated with app options    search('zebra') → []    search('quokka') → []
mismatched instance _fieldIds  {"nwo":0,"desc":1,"blurb":2,"topicsText":3,"tagsText":4}
                               (topics/tags are simply absent from the map)
```

On the deployed site, a repo reachable by `nwo`, `desc`, or `blurb` still hits — which is why casual testing hides this. Anything whose only match is a GitHub topic or a generated tag is unfindable, and `boost: { nwo: 3, tags: 2 }` is inert for `tags`. Given that tags and topics are half the indexed content and the LLM tier exists to *generate* tags, this defeats a primary feature.

Fix: make the two option objects identical. Export a shared `MINISEARCH_OPTIONS` from the pipeline and import it in `src/lib/search.ts`, or hand-mirror `topicsText`/`tagsText`. A round-trip test (`build → loadJSON → search('topic-only term')`) is a four-line guard against reintroducing it.

### 2. Canvas colours assigned as CSS variables never paint

**Severity: medium. Visual-only; no console errors.**

Canvas 2D parses `fillStyle`/`strokeStyle` as CSS colour *values*, not declarations — `var()` is not resolved. The assignment throws nothing; it is silently rejected, the property keeps its **previous valid value**, and it reads back as `#000000` on a fresh context.

Verified in headless Chromium 152:

```js
ctx.strokeStyle = "var(--health-active)"   // no error
ctx.strokeStyle                              // → "#000000" on a fresh context
// after a valid red stroke, assigning var() and stroking → pixel stays [255,0,0]
// assigning getComputedStyle(...).getPropertyValue("--health-active") → [107,184,90]
```

What that means per draw order inside `GraphView`'s `draw()` — each bad assignment inherits whatever colour was last valid, so the symptoms are specific rather than random:

| Line | Assignment | Verified effect |
|---|---|---|
| `:115` → `:285` | `colorForNode` returns `"var(--color-text)"` for `root` | **The root node's circle is invisible.** It is the first node drawn, so `fillStyle` is still the background colour from `:248` — the root paints `#1e1e1e` on `#1e1e1e`. Confirmed: sampled pixel `[30,30,30]`. Its label still draws (labels use the resolved path), so the cold-load view is a floating account name with no dot behind it. |
| `:292` | `strokeStyle = healthColor(state)` → `var(--health-*)` | Health rings never use the ramp. They take the last valid stroke from the edge loop (`rgba(150,155,165,0.25)`/`0.12`), so every repo looks identically grey. |
| `:297` | `strokeStyle = "var(--color-accent)"` | Selection halo draws in the dim edge grey, not terracotta. |
| `:332` | `strokeStyle = "var(--color-accent)"` | The hover/selected "focus edges" highlight is indistinguishable from ordinary edges — the affordance disappears. |
| `:315–316` | `"var(--color-surface)"` / `"var(--color-border)"` | The `+N` overflow circle takes the previous node's palette colour instead of surface/border. |

`GraphView` already does it correctly at `:248` and `:304` — `getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim()`, with a hex fallback — which is the pattern to follow. Fix: resolve the tokens once per draw into a plain `{ [key]: hex }` map and have `healthColor` return a literal rather than a `var()` string. The DOM usages (`style={{ background: healthColor(...) }}` in `ListView`, `RepoPanel`, `GraphView`'s tooltip and legend) are fine — only canvas is affected, which is why the rest of the site looks right and the graph looks subtly wrong.

Design intent broken here: colour-coding decay so a glance shows what is dying is a headline feature of the graph view, and it does not currently render.

### 3. A failed LLM batch is cached as rules-only forever

In `classifyAll`, every cache miss is pre-populated with a rules result carrying the *current* hash, then overwritten with the LLM result on success. If a batch throws (`llmFailed`) — or the model simply omits an `id` from its tool response — that repo keeps the rules entry with a hash that now matches.

Next run: `existing.hash === hash`, so it is never sent to the LLM again. The fix is manual — delete those keys from `cache/classifications.json`, or bump `taxonomy.version` to invalidate everything. Symptom: `unsorted_pct` stays high after adding a key even though the LLM tier appears to work.

## Spec vs. code drift

| `SPEC.md` | Code |
|---|---|
| `data/classifications.json` is the committed cache | It lives at `cache/classifications.json`; `data/` is gitignored, which is the right call, but §4's file list is stale. |
| "Click a hub → other hubs dim and collapse" (`§5.1`) | Other hubs stay at full size and full opacity. Only the visible *set* narrows. |
| "Hard cap of ~250 visible nodes" | `MAX_VISIBLE_REPOS = 200` **per leaf**, plus root + 12 hubs + that hub's leaves. Reasonable, just not the same number. |
| "`fetchStars` … stops at the first repo **ID it already knows**" | Correct, but `fetch.ts:23` comments `knownIds` as "from the classification cache" while `sync.ts:46` builds it from the merge baseline. Stale comment. |
| "Retry with exponential backoff on 403/429" | Also retries 502/503 — superset, harmless. |
| Model choice unspecified | Hardcoded `CLASSIFY_MODEL = "claude-opus-5"` with `output_config: { effort: "low" }`, 25 repos/call, `max_tokens: 4096`. Not configurable, and `stop_reason` is never inspected — a truncated batch would silently degrade to rules (see gap 3). |
| Weekly full pass to detect unstars | `shouldRunFullPass` is `now.getUTCDay() === 0` — Sunday UTC, independent of the `schedule` you configure. |

## Unused / wired-but-dead

- `fetchHistory()` (`src/lib/data.ts:17`) and `data/history.json` are produced and never consumed. `Timeline` aggregates `starred_at` client-side. Either delete the writer, or use `history.json` to draw growth-over-time (it has `added`/`removed`, which `starred_at` cannot reconstruct after an unstar).
- `meta.json.unsorted_pct`, `taxonomy_version`, and `shard_size` are written and typed but unread by the UI. `unsorted_pct` is exactly the M3 "under 10%" metric — it deserves a badge next to `rules-only`.
- `RepoRecord.is_fork` is stored, but `exclude_forks` already filtered at fetch time, so the field is only ever `false` when the flag is on. Harmless; `is_fork` is what the tooltip should arguably show.
- `src/lib/types.ts` and `pipeline/types.ts` duplicate `RepoRecord`, `MetaJson`, `GraphData`, `HealthState`. They match today; nothing enforces it. `HealthState` in the frontend is already unused (`palette.ts` takes `string`).

## Missing entirely

- **No tests of any kind.** The pipeline is pure functions with obvious unit targets — `computeHealth` thresholds, `matchRules` scoring, `hashFor` cache invalidation, `parseHash`/`buildHash` round-tripping, `shouldRunFullPass`. Gaps 1 and 2 are exactly the kind a handful of tests would catch, and gap 1 has a reproduction that can become a test verbatim.
- **No lint or format config.** Two `// eslint-disable-next-line react-hooks/exhaustive-deps` suppressions exist (`App.tsx:110`, `GraphView.tsx:179`) with no ESLint installed to justify or verify them.
- **No `LICENSE` file**, despite README/SPEC promising a forkable template — "Use this template" needs one.
- **No `dist/` smoke check in CI** beyond `tsc` on `src`. `npm run typecheck` (which also covers `pipeline`) is never run in the workflow, and type errors in `pipeline/**` would only surface as a `tsx` runtime failure mid-run.
- **No webfont delivery** — see [Theming and Tokens](Theming-and-Tokens.md).
- No keyboard focus trap or visible ring audit on the graph; the canvas is not reachable by keyboard at all, which is the accessibility ceiling of this design.
