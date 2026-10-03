# Known Gaps

The difference between what the code does, what `SPEC.md` describes, and what a reviewer would want. Verified against the current tree; each item says how it was checked.

## Fixed

Five defects that this page used to document as open are now closed, each with a regression test in `tests/`. They are kept here in short form because the mechanism is the lesson — and because a forker who pulls an older tag should be able to read what was wrong.

### 1. Topics and tags were not searchable

The pipeline indexed `["nwo", "desc", "blurb", "topicsText", "tagsText"]`; `src/lib/search.ts` rehydrated with `["nwo", "desc", "blurb", "topics", "tags"]`. `toJSON()` writes the build-time `fieldIds` map into the payload and `instantiateMiniSearch` restores `_fieldIds` **from that payload**, so the client's own `fields` option never rebuilds the map; at query time `this._fieldIds["topics"]` is `undefined`, the lookup misses, and the field contributes nothing — silently, with no error.

Now both sides import one object: `shared/searchSchema.ts` exports `SEARCH_OPTIONS`/`SEARCH_QUERY_OPTIONS`, used by `pipeline/buildIndex.ts:12` and `src/lib/search.ts:25`. The divergence is no longer representable. `tests/search.test.ts` does a real `buildSearchIndex → MiniSearch.loadJSON → search()` round trip and asserts a term present **only** in `topics` hits — the original bug reproduces as a failing test, verified by re-injecting the old field list.

### 2. Canvas colours assigned as CSS variables never painted

Canvas 2D parses `fillStyle`/`strokeStyle`/`font` as CSS *values*, so `var(--x)` is not a value: the assignment throws nothing, is silently rejected, and the property keeps its previous valid value. Verified again in headless Chromium 152 — after `ctx.font = "600 12px var(--font-sans)"` the `font` property reads back unchanged. DOM usage is unaffected, which is why the rest of the site looked right while the graph looked subtly wrong.

`src/lib/canvasTheme.ts` now resolves the palette once per draw into literal hex (`readCanvasTheme()`), and `GraphView` paints from that. Token names are spelled out in a `TOKENS` map rather than derived from field names, because `--bg` does not exist and `--accent` does — as the shadcn hover-surface alias, not the brand colour. The root fill, health rings, selection halo, focus edges, and the `+N` circle all draw in their intended colours. `tests/themeTokens.test.ts` parses `tokens.css` and asserts every value `readCanvasTheme()` returns, in both themes, including that `accent` is `--color-accent` and not the `--accent` alias.

### 3. Theme class was applied to `<body>`

The tokens live on `.dark`/`.light` blocks, and canvas resolved them with `getComputedStyle(document.documentElement)` — which reads `<html>`. Applying the class to `<body>` meant the documentElement saw no tokens at all and every canvas colour fell through to the hard-coded fallbacks. `App.tsx:52` and `index.html` now both put the class on `<html>`. See [Theming and Tokens](Theming-and-Tokens.md).

### 4. A failed LLM batch was cached as rules-only forever

In `classifyAll`, every cache miss was pre-populated with a rules result carrying the *current* content hash, then overwritten on success. If the batch threw — rate limit, network error, refused tool call — that repo kept a rules entry whose hash already matched, so no later run ever re-sent it. Fixing it meant hand-deleting cache keys.

`planClassifications()` (`pipeline/classify.ts:156`) now seeds a miss with `hash: PENDING_HASH` (`"pending"`) when an LLM pass is going to run, and the real hash is written only when the LLM result actually lands. `"pending"` can never collide with a sha1 digest, so a placeholder is re-queued next run. `tests/classify.test.ts` feeds a pending placeholder back in as an existing cache entry and asserts it is queued again.

### 5. Changing `login` merged the previous owner's stars into yours

`data/` is gitignored, so the merge baseline is scraped from the live Pages site. Nothing checked *whose* dataset that was. On an incremental run `sync.ts` merges baseline with fresh (`sync.ts:72`), so the first run after a `login` change would publish both accounts side by side. The shipped placeholder made this real rather than theoretical: `mb` is an unrelated GitHub user with 2 stars, so the site published *their* stars and looked almost empty instead of erroring.

`fetchPreviousDataset(login)` now compares the configured login against `meta.login` from the live site and throws on mismatch, which routes through the existing `baselineAvailable = false` path and forces one clean full pass. `tests/previousData.test.ts` covers same-account, other-account, missing login, and case-only differences. The placeholder in every copy-pasteable doc example is now `your-username`, which is not a GitHub account.

### Also closed

- **The canvas was unreachable by keyboard.** It is a focusable surface now, with a node cursor. Details in [Views](Views.md).
- **One malformed published row could blank the SPA.** `src/lib/data.ts:32` filters shards through `isUsableRepo` before they reach any component, so a row with `cat: [null]` or a missing `health` is dropped rather than thrown on. Found by driving the built site and confirmed by corrupting a published shard: 74 of 77 rows render instead of a white page.
- **A theme swap or a viewport change left the canvas stale.** The paint loop only runs when a React dependency changes, so `<html>`'s class changing outside React, or rotating a phone, used to leave the old colours and the old backing-store size. `themeTick` (`GraphView.tsx:95`) is bumped by a `MutationObserver` on the class attribute, a `prefers-color-scheme` listener, and `window.resize`.

## Spec vs. code drift

| `SPEC.md` | Code |
|---|---|
| `data/classifications.json` is the committed cache | It lives at `cache/classifications.json`; `data/` is gitignored, which is the right call, but §4's file list is stale. |
| "Click a hub → other hubs dim **and collapse**" (`§5.1`) | Dimming is implemented: sibling branches of the drilled-into hub draw at `globalAlpha 0.22` and their non-hub labels are suppressed (`GraphView.tsx:372`). They do not *collapse* — the nodes stay in place, they just recede. Positional stability was preferred over an animated collapse. |
| "Hard cap of ~250 visible nodes" | Per leaf, `MAX_VISIBLE_REPOS_FINE = 200` on a cursor and `MAX_VISIBLE_REPOS_COARSE = 60` on touch, plus root + 12 hubs + that hub's leaves. The phone number exists because 200 labelled dots on a 390px screen are unreadable, and the cap's purpose is legibility rather than a ceiling. Repos are ranked by stars before the cut, so overflow hides the smallest rather than the last in shard order. |
| "`fetchStars` … stops at the first repo **ID it already knows**" | Correct, but `fetch.ts:23` comments `knownIds` as "from the classification cache" while `sync.ts:46` builds it from the merge baseline. Stale comment. |
| "Retry with exponential backoff on 403/429" | Also retries 502/503 — superset, harmless. |
| Model choice unspecified | Hardcoded `CLASSIFY_MODEL = "claude-opus-5"` with `output_config: { effort: "low" }`, 25 repos/call, `max_tokens: 4096`. Not configurable, and `stop_reason` is never inspected — a truncated batch degrades to rules for those repos, though since gap 4 was fixed it is retried on the next run instead of permanently. |
| "Keyboard-first: … `f` fit-to-view" (`§5.3`) | Fit is `0` on the canvas, alongside `+`/`-` for zoom. `f` is not bound to anything. `Enter` is: it opens whatever the node cursor is on, and marks the event so the app-level handler doesn't open a second tab. |
| "Weekly full pass to detect unstars" | `shouldRunFullPass` is `now.getUTCDay() === 0` — Sunday UTC, independent of the `schedule` you configure. |

## Unused / wired-but-dead

- `fetchHistory()` (`src/lib/data.ts:17`) and `data/history.json` are produced and never consumed. `Timeline` aggregates `starred_at` client-side. Either delete the writer, or use `history.json` to draw growth-over-time (it has `added`/`removed`, which `starred_at` cannot reconstruct after an unstar).
- `meta.json.unsorted_pct`, `taxonomy_version`, and `shard_size` are written and typed but unread by the UI. `unsorted_pct` is exactly the M3 "under 10%" metric — it deserves a badge next to `rules-only`.
- `RepoRecord.is_fork` is stored, but `exclude_forks` already filtered at fetch time, so the field is only ever `false` when the flag is on. Harmless; `is_fork` is what the tooltip should arguably show.
- `src/lib/types.ts` and `pipeline/types.ts` duplicate `RepoRecord`, `MetaJson`, `GraphData`, `HealthState`. They match today; nothing enforces it. `shared/searchSchema.ts` proves the pattern is available when a mismatch has consequences — the types are the next candidate.

## Missing entirely

- **No lint or format config.** Two `// eslint-disable-next-line react-hooks/exhaustive-deps` suppressions exist (`App.tsx:120`, `GraphView.tsx:265`), each deliberate — they key an effect on a derived string rather than a fresh array — but with no ESLint installed nothing verifies they are still the right call.
- **CI runs neither `npm test` nor `npm run typecheck`.** The workflow calls `npm run build`, which type-checks `src` only. Thirty-one unit tests exist and would catch a regression in minutes, and `pipeline/**` type errors still surface only as a mid-run `tsx` failure. Adding a step is a two-line change.
- **No webfont delivery** — see [Theming and Tokens](Theming-and-Tokens.md).
- **No CI job runs the browser checks.** The phone-first layout, canvas painting, and keyboard path were verified by driving headless Chromium over CDP against a built site with a synthetic dataset. That harness is not in the repo and not in the pipeline; it is a strong candidate for a `playwright` job on the workflow, since these are precisely the bugs type-checking cannot see.

## Accessibility ceiling

The graph is now operable without a mouse: arrows walk nodes, Enter/Space descends, `+`/`-`/`0` zoom and fit, each move announced through an `aria-live` region, and the canvas's `aria-label` states the current view and the key contract. The cursor is drawn (dashed accent ring) and survives the mouse. What remains inherently limited: it is a spatial display, so a screen-reader user hears a list of nodes in layout order rather than a picture of the relationships, and the hover tooltip has no touch equivalent. The List view is the accessible path — which is a legitimate design, as long as it is discoverable.
