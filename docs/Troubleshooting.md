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
Almost always an absolute path. The app must use `base: "./"` and relative `./data/...` fetches; project Pages sites serve from `/<repo>/`. Check the browser network tab for requests to `/data/meta.json` (wrong) versus `/<repo>/data/meta.json` (right). Also confirm `public/.nojekyll` made it into `dist/`.

**Deploy job is skipped or never fires.**
`deploy` has `needs: build`. If `build` failed — including the type-check inside `npm run build` — there is no artifact. Read the `build` log, not the deploy one.

**First run does a full sync and takes much longer than later runs.**
Expected. No published site means no merge baseline, so it walks every page and classifies everything.

## Sync

**`GITHUB_TOKEN is required to fetch starred repos`.**
Locally, `GITHUB_TOKEN=<token> npm run sync`. In CI this means the `env:` block was removed from the sync step.

**`No previous dataset available, running a full pass` on every run.**
The pipeline cannot reach its own published JSON. Check that `GITHUB_REPOSITORY` is present, that the Pages URL actually serves `/data/meta.json`, and that you are not using a custom domain — set `PAGES_URL` explicitly in that case.

**`Cannot determine Pages URL`.**
Neither `PAGES_URL` nor `GITHUB_REPOSITORY` is set. Locally: `PAGES_URL=https://<owner>.github.io/<repo> npm run sync`.

**Repos I unstarred are still listed.**
Unstars are only removed by a **full pass**, which runs on Sunday (UTC) or when the baseline is unreachable. To force it now, add `FORCE_FULL: "1"` to the sync step's env, or trigger a run on a Sunday.

**`Sync failed, aborting without publishing`.**
The run bailed before writing output — by design, so the previous night's site stays live. The message above it names the cause; a fetch failure usually means the retry budget (5 attempts) was exhausted, i.e. genuine rate limiting or an API outage rather than a bug.

## Classification

**The header shows a `rules-only` badge.**
Either no `ANTHROPIC_API_KEY` secret, or at least one LLM batch failed. The workflow log distinguishes them: look for `LLM classification batch failed, keeping rules-tier results`. Rules-only is a supported mode, not an error state.

**I added a key but categories didn't improve.**
The cache already holds rules-tier entries with matching hashes for those repos, so they are never re-sent. Bump `taxonomy.json`'s `version` to invalidate the whole cache, or delete the specific IDs from `cache/classifications.json`. See [Known Gaps](Known-Gaps.md) — a failed LLM batch is cached as rules-only permanently, which makes this the expected failure mode after a transient API error.

**`unsorted_pct` is high.**
Expected without the LLM tier: repos with no GitHub topics cannot be matched by rules. First try adding keywords to `taxonomy.json` leaf `topics` — free and deterministic. Accept roughly a 5% floor; sparse repos have nothing to classify from.

**Renaming a category broke the tree.**
You changed leaf IDs without bumping `version`. Old IDs in the cache no longer exist in the taxonomy, so those nodes are missing from the graph. Bump `version` and re-run.

## Search

**Searching a topic or tag returns nothing but the repo is clearly in the list.**
This is a bug, not misconfiguration — the index is built with `topicsText`/`tagsText` fields and rehydrated with `topics`/`tags`, so those fields contribute nothing to matches. Workaround: search words that appear in the repo name or description. Fix in [Known Gaps](Known-Gaps.md).

**Search finds nothing at all.**
`searchReady` is false until `data/search.json` loads. Check the network tab; a 404 on that file usually means `npm run sync` was skipped before `npm run build`.

## Graph

**Health rings all look the same colour instead of a green→grey ramp.**
Also a bug: canvas `strokeStyle` does not accept `var(--…)`. See [Known Gaps](Known-Gaps.md). The DOM dots in List and Graveyard are correct — use them to read health for now.

**The whole map reshuffled after a normal night.**
`cache/positions.json` was deleted, never committed, or the workflow lost write permission and could not save it. Positions are the only thing keeping the layout stable between runs.

**A category shows "no repos" right after loading.**
Repo shards load during browser idle time, so `reposById` fills gradually. Wait for the shards, or check that `shard_count` in `meta.json` matches the files actually served.

**The list is empty but the graph looks fine.**
Same cause — the graph needs only `graph.json`; the list needs shards. If shards 404, your `data/` is stale relative to `meta.json`: re-run `npm run sync` and rebuild.

**Clicking `+N more` goes to a list that seems unfiltered.**
That is by design: the cap is per leaf and the List view has no cap, so you see every repo in that leaf. Facets in the List header narrow it from there.
