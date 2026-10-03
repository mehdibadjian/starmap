# Troubleshooting

Symptoms, in the order they most commonly appear.

## CI / deploy

**The commit step fails with 403 / `resource not accessible by integration`.**
Workflow permissions are still "Read only". Settings → Actions → General → Workflow permissions → **Read and write permissions**, then re-run. Runs started before you changed the setting keep the old permissions, so a re-run of the *failed* run is not enough — start a fresh one.

**The site never updates, no errors.**
Pages source is not set to GitHub Actions. Settings → Pages → Build and deployment → Source: **GitHub Actions**. With "Deploy from a branch" selected, `upload-pages-artifact` succeeds and nothing publishes.

**Nothing runs on my pushes.**
The `on: push` trigger is `branches: [main]` only. Push to the default branch or use **Run workflow**.

**Blank page, or a 404 on the deployed site.**
A genuinely blank page is now rare: if `meta.json` or `graph.json` fails to load the app renders the failing path, a hint, and a Retry button. So start from the network tab. A 404 is almost always an absolute path — the app must use `base: "./"` and relative `./data/...` fetches; project Pages sites serve from `/<repo>/`. Check for requests to `/data/meta.json` (wrong) versus `/<repo>/data/meta.json` (right). Also confirm `public/.nojekyll` made it into `dist/`.

If the page is blank *with* no console error and the data files all return 200, that points at a JS throw during render rather than a missing file. Reproduce with the browser console open; published rows are validated at the shard boundary, so if you find a render-time throw, the likely cause is a field the views index into that the guard doesn't cover yet.

**Deploy job is skipped or never fires.**
`deploy` has `needs: build`. If `build` failed — including the type-check inside `npm run build` — there is no artifact. Read the `build` log, not the deploy one.

**First run does a full sync and takes much longer than later runs.**
Expected. No published site means no merge baseline, so it walks every page and classifies everything.

## Sync

**`GITHUB_TOKEN is required to fetch starred repos`.**
Locally, `GITHUB_TOKEN=<token> npm run sync`. In CI this means the `env:` block was removed from the sync step.

**`No usable previous dataset, running a full pass` on every run.**
The pipeline cannot reach its own published JSON. Check that `GITHUB_REPOSITORY` is present, that the Pages URL actually serves `/data/meta.json`, and that you are not using a custom domain — set `PAGES_URL` explicitly in that case.

**`published dataset belongs to "X", not "Y"` — and the next run is a full pass.**
Expected the first time after you change `login` in `config.yml`. The merge baseline is scraped from the live site, and it still holds the *previous* account's stars; merging those would have published both accounts, so the baseline is rejected and rebuilt instead. One full pass, then incremental runs resume. If this appears on every run, `config.yml` and the deployed `data/meta.json` genuinely disagree — the site you are reading as the baseline is not the one this config publishes to, so check `PAGES_URL`.

**`Cannot determine Pages URL`.**
Neither `PAGES_URL` nor `GITHUB_REPOSITORY` is set. Locally: `PAGES_URL=https://<owner>.github.io/<repo> npm run sync`.

**Repos I unstarred are still listed.**
Unstars are only removed by a **full pass**, which runs on Sunday (UTC) or when the baseline is unreachable. To force it now, use **Run workflow** on *Starmap sync + deploy* and tick **full_pass**; locally, `FORCE_FULL=1 npm run sync`. Editing the workflow YAML is no longer the only way.

**`Sync failed, aborting without publishing`.**
The run bailed before writing output — by design, so the previous night's site stays live. The message above it names the cause; a fetch failure usually means the retry budget (5 attempts) was exhausted, i.e. genuine rate limiting or an API outage rather than a bug.

## Classification

**The header shows a `rules-only` badge.**
Either no `ANTHROPIC_API_KEY` secret, or at least one LLM batch failed. The workflow log distinguishes them: look for `LLM classification batch failed, keeping rules-tier results`. Rules-only is a supported mode, not an error state.

**I added a key but categories didn't improve.**
Since the pending-hash fix, a batch that failed is retried automatically on the next run — a persistent `rules-only` badge after adding the key means the LLM calls are still failing, so read the workflow log for `LLM classification batch failed` rather than clearing the cache by hand. Two cases where manual intervention *is* correct: entries classified before the fix, which carry a real hash and will never be re-queued, and renamed or removed leaf IDs. For those, bump `taxonomy.json`'s `version` to invalidate the whole cache, or delete the specific IDs from `cache/classifications.json`.

**`unsorted_pct` is high.**
Expected without the LLM tier: repos with no GitHub topics cannot be matched by rules. First try adding keywords to `taxonomy.json` leaf `topics` — free and deterministic. Accept roughly a 5% floor; sparse repos have nothing to classify from.

**Renaming a category broke the tree.**
You changed leaf IDs without bumping `version`. Old IDs in the cache no longer exist in the taxonomy, so those nodes are missing from the graph. Bump `version` and re-run.

## Search

**Searching a topic or tag returns nothing but the repo is clearly in the list.**
This was a bug and is fixed: the indexer and the client now share `shared/searchSchema.ts`, and `tests/search.test.ts` fails if the field names diverge again. If it happens on *your* fork, the cause is almost always a stale `search.json` published from an older build — re-run `npm run sync` and rebuild, and don't hand-edit one side of the schema.

If a specific term still misses, check what field it lives in: search covers `nwo`, `desc`, `blurb`, and the joined `topics`/`tags`. It does not cover `lang`, license, or the homepage.

**Search finds nothing at all.**
`searchReady` is false until `data/search.json` loads; the header then shows a `search off` badge and the rest of the app keeps working. A 404 on that file usually means `npm run sync` was skipped before `npm run build`.

## Graph

**The map looks grey and flat, with no terracotta anywhere.**
Two distinct causes. If the *health rings* are all the same colour, that is the `var()`-on-canvas bug — fixed, and `src/lib/canvasTheme.ts` now resolves tokens to literals; a fork carrying hand-merged changes should check nothing assigns `ctx.fillStyle = "var(…)"`. If the whole palette is wrong, the theme class is probably on `<body>` instead of `<html>`: canvas reads `getComputedStyle(document.documentElement)`, so a class on `<body>` leaves every token unresolved and the fallbacks show through.

**Colours or sizes don't update after changing the theme, or after rotating the phone.**
The canvas only repaints when a React dependency changes. `GraphView`'s `themeTick` effect (`:107`) covers the three things that don't: a class change on `<html>`, a `prefers-color-scheme` switch, and `window.resize`. If you replace that effect, keep all three — the resize case in particular has no other trigger.

**Pinching the map zooms the whole page, or one finger scrolls the list instead of panning.**
`touch-action: none` on the canvas is what hands those gestures to the pointer handlers. It is on the element's class list (`touch-none`) — losing it makes both gestures fall through to the browser.

**Taps select nothing, or select the wrong dot.**
Touch hit-testing uses `radius + 12` slop and a 10px drag threshold. Both are tuned for fingers; shrinking either makes taps feel dead on glass. Repo nodes also have a 6px minimum radius on touch, so a two-star repo stays tappable.

**The whole map reshuffled after a normal night.**
`cache/positions.json` was deleted, never committed, or the workflow lost write permission and could not save it. Positions are the only thing keeping the layout stable between runs.

**The bottom of the map is cut off, or the page scrolls when you drag the graph, on a phone.**
Two separate requirements. The shell is `h-[100dvh]` — `100vh` on iOS is the *large* viewport, taller than what's actually visible once the URL bar is in the way, so controls end up underneath it. And `touch-action: none` on the canvas is what stops a one-finger drag being read as page scroll.

**Something is wider than the screen and the page scrolls sideways.**
The header wraps to two rows below `sm` rather than squeezing four tab labels and a search box into 390px; the breadcrumb row scrolls horizontally inside its own container instead of pushing the document wide. When adding chrome, check `document.documentElement.scrollWidth === innerWidth` at 390px — that's the assertion the layout is held to.

**Tapping a category shows nothing.**
Three different causes, now distinguishable at a glance:
- *The category is genuinely empty.* Empty leaves are pruned from `graph.json`, so a dot you can tap should always have repos. If the view says **"Nothing in this category"**, you reached it by a stale bookmark or a hand-typed hash — that message is the fix working, not failing.
- *You tapped a hub and only leaf dots drew.* That was the bug: the hub view rendered its children but not their repos, so a category with hundreds of stars looked exactly like an empty one. `GraphView.tsx:233` now draws the hub's repos up to the touch cap. If you are on a fork with hand-merged changes and it is back, check that the `else` branch of that memo exists.
- *The shards haven't landed yet.* See the next entry.

**A category shows "no repos" right after loading.**
Repo shards load during browser idle time, so `reposById` fills gradually. Wait for the shards, or check that `shard_count` in `meta.json` matches the files actually served.

**Rows seem to be missing from the list, and the count is lower than the graph.**
`src/lib/data.ts` drops shard rows that fail validation (`id`/`nwo`/`cat`/`topics`/`tags`/`health.state`) rather than letting one bad record blank the page. That is intentional, but it is silent — if the header total and the visible rows disagree, compare `meta.json.total` against `jq 'length'` on the shards to find which file has the malformed entries.

**The list is empty but the graph looks fine.**
Same cause — the graph needs only `graph.json`; the list needs shards. If shards 404, your `data/` is stale relative to `meta.json`: re-run `npm run sync` and rebuild.

**Pressing Enter on the map opens two GitHub tabs.**
It shouldn't: the canvas owns Enter while its node cursor is active and marks the event so the window-level handler in `App.tsx:141` stands down. If you see the doubling again, the mark or the check was lost in a merge.

**Clicking `+N more` goes to a list that seems unfiltered.**
That is by design: the cap is per leaf and the List view has no cap, so you see every repo in that leaf. Facets in the List header narrow it from there.

## Local checks

**`npm run smoke` refuses to run: `no dataset found`.**
Run `npm run fixture` first. `data/` is gitignored, so a fresh clone has nothing to serve — this is the same reason the CI browser job generates a fixture before it builds.

**`npm run smoke` refuses to run: `dist/ is stale relative to public/data`.**
The harness byte-compares `public/data/graph.json` against `dist/data/graph.json` and stops if they differ, because a green run against an old bundle proves nothing. Run `npm run build`.

**`npm run smoke` reports `none of … exposed a working DevTools endpoint`.**
It tries `google-chrome-stable`, `google-chrome`, `chromium`, `chromium-browser` in that order and keeps the first that exposes a usable endpoint, printing why each rejection happened. A `spawn <name> ENOENT` line is just "not installed under that name". A line quoting the browser's own output — often a D-Bus complaint — means it launched and never wrote the port file within the wait; on Linux that is usually a snap-confined Chromium, so `CHROME_PATH=/path/to/browser npm run smoke` with a plain (non-snap) binary. A line saying `exited with …` means the browser died on its own, which on a laptop is normally a profile problem — each attempt uses a fresh `--user-data-dir`, so check `TMPDIR` is writable and not shared with another concurrent run. If CI shows this flaking between runs on the same commit, the environment is the suspect, not the code — see [Known Gaps](Known-Gaps.md).

To drive a browser you started yourself, set `CDP_PORT` to its fixed port; the harness attaches instead of launching.

**`npm run smoke` passes locally but fails in CI (or the reverse) at `vite preview is not serving …`.**
The harness only starts its own preview server when nothing already answers `SMOKE_BASE`, so a stray `npm run preview` left on 4173 makes the local run test a server it didn't start. `pkill -f "vite preview"` and re-run before believing a green. The failure message now quotes the server's own output, which distinguishes a missing `dist/` from a port clash from a slow machine.

**A check fails that passed yesterday.**
Every check in the suite can fail — there is no advisory tier, because each "report but don't fail" line that ever existed turned out to describe a real defect. Read the `—` detail after the failing name: it quotes what the page actually reported (`visible=0`, `55 emitted / 55 in taxonomy`), which is usually enough to tell a data change from a code regression.
