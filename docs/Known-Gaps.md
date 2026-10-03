# Known Gaps

The difference between what the code does, what `SPEC.md` describes, and what a reviewer would want. Verified against the current tree; each item says how it was checked.

## Fixed

Six defects this page used to document as open are now closed, each with a regression test in `tests/` (the sixth is a structural fix the compiler itself enforces). They are kept here in short form because the mechanism is the lesson — and because a forker who pulls an older tag should be able to read what was wrong.

### 1. Topics and tags were not searchable

The pipeline indexed `["nwo", "desc", "blurb", "topicsText", "tagsText"]`; `src/lib/search.ts` rehydrated with `["nwo", "desc", "blurb", "topics", "tags"]`. `toJSON()` writes the build-time `fieldIds` map into the payload and `instantiateMiniSearch` restores `_fieldIds` **from that payload**, so the client's own `fields` option never rebuilds the map; at query time `this._fieldIds["topics"]` is `undefined`, the lookup misses, and the field contributes nothing — silently, with no error.

Now both sides import one object: `shared/searchSchema.ts` exports `SEARCH_OPTIONS`/`SEARCH_QUERY_OPTIONS`, used by `pipeline/buildIndex.ts:16` and `src/lib/search.ts:25`. The divergence is no longer representable. `tests/search.test.ts` does a real `buildSearchIndex → MiniSearch.loadJSON → search()` round trip and asserts a term present **only** in `topics` hits — the original bug reproduces as a failing test, verified by re-injecting the old field list.

### 2. Canvas colours assigned as CSS variables never painted

Canvas 2D parses `fillStyle`/`strokeStyle`/`font` as CSS *values*, so `var(--x)` is not a value: the assignment throws nothing, is silently rejected, and the property keeps its previous valid value. Verified again in headless Chromium 152 — after `ctx.font = "600 12px var(--font-sans)"` the `font` property reads back unchanged. DOM usage is unaffected, which is why the rest of the site looked right while the graph looked subtly wrong.

`src/lib/canvasTheme.ts` now resolves the palette once per draw into literal hex (`readCanvasTheme()`), and `GraphView` paints from that. Token names are spelled out in a `TOKENS` map rather than derived from field names, because `--bg` does not exist and `--accent` does — as the shadcn hover-surface alias, not the brand colour. The root fill, health rings, selection halo, focus edges, and the `+N` circle all draw in their intended colours. `tests/themeTokens.test.ts` parses `tokens.css` and asserts every value `readCanvasTheme()` returns, in both themes, including that `accent` is `--color-accent` and not the `--accent` alias.

### 3. Theme class was applied to `<body>`

The tokens live on `.dark`/`.light` blocks, and canvas resolved them with `getComputedStyle(document.documentElement)` — which reads `<html>`. Applying the class to `<body>` meant the documentElement saw no tokens at all and every canvas colour fell through to the hard-coded fallbacks. `App.tsx:54` and `index.html` now both put the class on `<html>`. See [Theming and Tokens](Theming-and-Tokens.md).

### 4. A failed LLM batch was cached as rules-only forever

In `classifyAll`, every cache miss was pre-populated with a rules result carrying the *current* content hash, then overwritten on success. If the batch threw — rate limit, network error, refused tool call — that repo kept a rules entry whose hash already matched, so no later run ever re-sent it. Fixing it meant hand-deleting cache keys.

`planClassifications()` (`pipeline/classify.ts:156`) now seeds a miss with `hash: PENDING_HASH` (`"pending"`) when an LLM pass is going to run, and the real hash is written only when the LLM result actually lands. `"pending"` can never collide with a sha1 digest, so a placeholder is re-queued next run. `tests/classify.test.ts` feeds a pending placeholder back in as an existing cache entry and asserts it is queued again.

### 5. Changing `login` merged the previous owner's stars into yours

`data/` is gitignored, so the merge baseline is scraped from the live Pages site. Nothing checked *whose* dataset that was. On an incremental run `sync.ts` merges baseline with fresh (`sync.ts:72`), so the first run after a `login` change would publish both accounts side by side. The shipped placeholder made this real rather than theoretical: `mb` is an unrelated GitHub user with 2 stars, so the site published *their* stars and looked almost empty instead of erroring.

`fetchPreviousDataset(login)` now compares the configured login against `meta.login` from the live site and throws on mismatch, which routes through the existing `baselineAvailable = false` path and forces one clean full pass. `tests/previousData.test.ts` covers same-account, other-account, missing login, and case-only differences. The placeholder in every copy-pasteable doc example is now `your-username`, which is not a GitHub account.

### 6. The data contract was hand-mirrored in two places

`src/lib/types.ts` and `pipeline/types.ts` each declared their own `RepoRecord`, `MetaJson`, `GraphData`, `HealthState`, and `HistoryEntry`. They agreed, and nothing enforced it — the same class of bug as gap 1, where two hand-maintained copies of one contract drift and the failure is silent.

`shared/dataSchema.ts` is now the single definition; both files re-export from it, exactly as `shared/searchSchema.ts` already did for the search fields. The comment on `RepoRecord.cat` states the rule the graph depends on — `cat[0]` is the primary category a repo files under — because the pruning in gap "Tapping a category" reads it. Renaming a field on one side is now a type error rather than a runtime surprise.

### Also closed

- **The canvas was unreachable by keyboard.** It is a focusable surface now, with a node cursor. Details in [Views](Views.md).
- **One malformed published row could blank the SPA.** `src/lib/data.ts:35` filters shards through `isUsableRepo` before they reach any component, so a row with `cat: [null]` or a missing `health` is dropped rather than thrown on. Found by driving the built site and confirmed by corrupting a published shard: 74 of 77 rows render instead of a white page.
- **A theme swap or a viewport change left the canvas stale.** The paint loop only runs when a React dependency changes, so `<html>`'s class changing outside React, or rotating a phone, used to leave the old colours and the old backing-store size. `themeTick` (`GraphView.tsx:95`) is bumped by a `MutationObserver` on the class attribute, a `prefers-color-scheme` listener, and `window.resize`.
- **Tapping a category on the graph opened an empty view.** Two separate defects, found by driving the built site over CDP and confirmed by re-injecting each one and watching the suite go red.
  1. `buildGraph` emitted a leaf node for every category in `taxonomy.json`, including the ones this account has never starred. Those dots were tappable, resolved to a real hash, and had no repos under them — the map advertised places to go that were genuinely empty. Leaves are now pruned on **attachment** (`attachedOf`, `pipeline/graph.ts:118`), which counts a repo's *primary* category (`cat[0]`) rather than the displayed count, and roots are emitted only when at least one of their leaves survives. Pruning on the displayed count would have kept the bug alive: a leaf that is only ever a second category shows a count yet still has nothing under it.
  2. The hub view showed only its leaf dots, so drilling into a category with hundreds of repos looked identical to drilling into an empty one. `GraphView` now renders repos under every leaf of the hub, capped for legibility and ranked by stars, with one `+N` circle per leaf accounting for what was hidden (`src/components/GraphView.tsx:228`).
  A drilled path that names no node at all — a stale bookmark, a hand-typed URL — now draws an explicit "Nothing in this category" card with a way back, instead of a blank canvas that reads as a failure (`GraphView.tsx:782`). `tests/graph.test.ts` covers the pruning rule; `npm run smoke` covers the hub rendering, the `+N` arithmetic, and the empty state.
- **Six suggestions a reviewer would make, all now closed.** No lint config → `eslint.config.js`, flat config over TS and the `.mjs` harness, 0 errors and 0 warnings across 57 files, and it caught two real defects on its first run (a `missing ) after argument list` in a test file that had been committed unparseable, and an unused binding). `npm test` and `npm run typecheck` not in CI → both run in `ci.yml` and gate `nightly.yml`. No webfont delivery → `src/styles/fonts.css` + three hashed woff2 files, with the load asserted in the browser suite. No browser CI job → `ci.yml`'s second job runs the fixture → build → smoke path. Dead code (`fetchHistory`) → deleted, with a comment explaining why it stays deleted. Duplicated types → `shared/dataSchema.ts`, gap 6 above.
- **`meta.json.unsorted_pct` was written but never shown.** It is the SPEC's M3 metric ("`unsorted` under 10%"), and on the live site it was 58.7% with nobody able to see it. `src/lib/metaBadges.ts` now decides both the threshold and the label — a badge appears in the header only at or above the target, and its tooltip names the two remedies (add an `ANTHROPIC_API_KEY` secret, or extend `taxonomy.json`). The derivation is computed once in `App.tsx:154` so the condition and the text cannot drift; `tests/metaBadges.test.ts` pins the boundary at 10, not at an invented number.

## Spec vs. code drift

| `SPEC.md` | Code |
|---|---|
| `data/classifications.json` is the committed cache | It lives at `cache/classifications.json`; `data/` is gitignored, which is the right call, but §4's file list is stale. |
| "Click a hub → other hubs dim **and collapse**" (`§5.1`) | Dimming is implemented: sibling branches of the drilled-into hub draw at `globalAlpha 0.22` and their non-hub labels are suppressed (`GraphView.tsx:417`). They do not *collapse* — the nodes stay in place, they just recede. Positional stability was preferred over an animated collapse. |
| "Hard cap of ~250 visible nodes" | Per leaf, `MAX_VISIBLE_REPOS_FINE = 200` on a cursor and `MAX_VISIBLE_REPOS_COARSE = 60` on touch, plus root + the populated hubs + that hub's leaves and (at hub level) that hub's repos up to the same cap. The phone number exists because 200 labelled dots on a 390px screen are unreadable, and the cap's purpose is legibility rather than a ceiling. Repos are ranked by stars before the cut, so overflow hides the smallest rather than the last in shard order. |
| "`fetchStars` … stops at the first repo **ID it already knows**" | Correct, and the `knownIds` comment in `pipeline/fetch.ts:23` now says where they come from (the merge baseline, per `sync.ts:46`) rather than the classification cache. |
| "Retry with exponential backoff on 403/429" | Also retries 502/503 — superset, harmless. |
| Model choice unspecified | Hardcoded `CLASSIFY_MODEL = "claude-opus-5"` with `output_config: { effort: "low" }`, 25 repos/call, `max_tokens: 4096`. Not configurable, and `stop_reason` is never inspected — a truncated batch degrades to rules for those repos, though since gap 4 was fixed it is retried on the next run instead of permanently. |
| "Keyboard-first: … `f` fit-to-view" (`§5.3`) | Fit is `0` on the canvas, alongside `+`/`-` for zoom. `f` is not bound to anything. `Enter` is: it opens whatever the node cursor is on, and marks the event so the app-level handler doesn't open a second tab. |
| "Weekly full pass to detect unstars" | `shouldRunFullPass` is `now.getUTCDay() === 0` — Sunday UTC, independent of the `schedule` you configure. |

## Still open

These are the honest remaining gaps. None of them is a bug; they are scope, and each says what it would take.

- **`data/history.json` has no browser reader.** The pipeline writes it and `previousData.ts` carries it forward so the growth series survives a full pass, but nothing in the SPA consumes it — `Timeline` derives stars-per-month from `starred_at` across the shards. It is worth keeping because `starred_at` *cannot* reconstruct `removed` after an unstar, so `history.json` is the only record of churn. The gap is that it is data with no display: a growth-over-time line would use it, and until then it is write-only. (`fetchHistory()` used to exist in `src/lib/data.ts` and was deleted; the comment where it lived says why it should stay deleted rather than be re-added as dead code.)
- **`meta.json.shard_size` and `taxonomy_version` are unread by the UI.** Both are written, typed, and used as *pipeline* inputs — `classify.ts:28` invalidates the cache on a taxonomy-version change, and `shard_size` documents the sharding for a fork reading the output. Neither is a metric a viewer needs, so the right call is to leave them in `meta.json` as provenance rather than invent a place to show them.
- **`RepoRecord.is_fork` is stored but always `false` when `exclude_forks` is on**, because the filter already ran at fetch time. Harmless, and the field is correct when the flag is off; `is_fork` is what the tooltip should arguably show instead of hiding the fact.
- **No formatter.** `eslint.config.js` catches defects but deliberately says nothing about style — no Prettier, no `--fix` opinionated set. On a repo edited from a phone, an autoformat-on-save loop that rewrites whole files is a worse trade than a little inconsistency.
- **The browser suite is Chromium-only.** It uses the DevTools Protocol, so it cannot run against Firefox or Safari, and `pointer: coarse` is simulated by viewport + `Emulation.setTouchEmulationEnabled` rather than by a real touchscreen. What that costs: a phone-WebKit-specific bug (100dvh handling, `touch-action` quirks, font-load timing) would pass CI. A real-device sweep is the fix and it is not a small one.
- **One CI browser flake is worked around, not explained.** In the suite's first week the same commit passed the browser job in one run and failed it in another, on the same runner image version, in three consecutive runs. First failure named one binary (`chromium did not expose a debugging port`), the next named all four. The harness now walks candidate binaries instead of trusting `--version`, gives each attempt a private `--user-data-dir`, and asks for `--remote-debugging-port=0` so it reads back the port the browser picked from that profile's `DevToolsActivePort` file — which is also the readiness signal, replacing a fixed timeout. That removes the obvious shared-resource suspect, a hard-coded 9222, and makes the failure mode harder to hit; it is still not a reproduced root cause, and the candidate ordering remains a hypothesis about snap confinement rather than a finding. If the suite goes red in CI with a message naming more than one browser, treat the environment as the suspect and re-run before bisecting the code.

## Accessibility ceiling

The graph is now operable without a mouse: arrows walk nodes, Enter/Space descends, `+`/`-`/`0` zoom and fit, each move announced through an `aria-live` region, and the canvas's `aria-label` states the current view and the key contract. The cursor is drawn (dashed accent ring) and survives the mouse. What remains inherently limited: it is a spatial display, so a screen-reader user hears a list of nodes in layout order rather than a picture of the relationships, and the hover tooltip has no touch equivalent. The List view is the accessible path — which is a legitimate design, as long as it is discoverable.
