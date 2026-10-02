# Data Pipeline

One entrypoint, run nightly in CI and runnable locally:

```bash
npm run sync        # → tsx pipeline/sync.ts
```

It performs, in order (`pipeline/sync.ts`):

1. Load `config.yml` and the taxonomy.
2. Require `GITHUB_TOKEN` (throws immediately without it).
3. Fetch the previous dataset from the live Pages site → merge baseline + history.
4. Load `cache/classifications.json` for the current taxonomy version.
5. Decide full vs. incremental pass.
6. Fetch stars.
7. Classify (rules tier always, LLM tier if enabled).
8. Enrich into `RepoRecord`s, merge with the baseline, recompute health.
9. Build the graph and lay it out.
10. Write `public/data/*`.
11. Write `cache/classifications.json`, `cache/positions.json`, `LAST_SYNC`.

Any throw before step 10 exits non-zero without publishing, so a partial API failure never ships a truncated dataset.

## Fetch (`pipeline/fetch.ts`)

`GET /users/{login}/starred` with `per_page: 100` and `Accept: application/vnd.github.star+json`, which is what puts `starred_at` next to the repo object. Results come back newest-star first, and that ordering is the whole basis of incremental mode.

Each raw repo is projected down to a `RawStar` record — `id`, `nwo`, `desc`, `lang`, `topics`, `stars`, `forks`, `license` (SPDX), `archived`, `is_fork`, `pushed_at`, `created_at`, `starred_at`, `homepage`. `exclude_forks: true` drops repos where the API says `fork: true`.

Requests retry on **403, 429, 502, 503** with exponential backoff (1s, 2s, 4s, 8s, 16s; five attempts) and then throw. With `GITHUB_TOKEN`'s 5,000 requests/hour and 100 records per request, 5,000 stars is ~50 requests — rate limits are a non-issue.

## Full pass vs. incremental

```ts
shouldRunFullPass(now, force) // force || now.getUTCDay() === 0
```

A **full pass** runs every Sunday (UTC), whenever the baseline is unavailable, or when `FORCE_FULL=1`. It walks every page, which is the only way to notice a repo you unstarred.

An **incremental** run stops at the first repo ID already in the baseline and merges. New stars appear above known ones in the ordering, so this is cheap — typically one page a night.

| | Full pass | Incremental |
|---|---|---|
| Pages fetched | all | until first known repo |
| Unstars detected | yes | **no** |
| `removed` in history | counted from baseline | always `0` |
| Merge | replaces the list | baseline + fresh, newest-starred first |

`added` and `removed` are only meaningful when a baseline was reachable; on the very first run `added` equals the whole list and `removed` is `0`.

## Merge baseline comes from the live site

Because `data/` is gitignored, the last full dataset exists only as published JSON. `pipeline/previousData.ts` reconstructs the Pages URL from `PAGES_URL`, or from `GITHUB_REPOSITORY` (with the `owner.github.io` user-site case handled), then loads `data/meta.json` and all `shard_count` repo shards in parallel, plus `history.json` on a best-effort basis. Each request has a 15-second timeout.

If anything is unreachable, the caller logs a warning, sets `baselineAvailable = false`, and forces a full pass. That is why the first run, a run after a rename, or a run while Pages is down always costs a full fetch.

## Health

`pipeline/health.ts` maps `pushed_at` + `archived` onto five states with fixed thresholds:

| State | Condition |
|---|---|
| `archived` | repo is archived (wins over everything) |
| `dead` | ≥ 730 days since last push |
| `stale` | ≥ 365 days |
| `slowing` | ≥ 90 days |
| `active` | < 90 days |

Health is deliberately recomputed for **every** record at build time (`sync.ts:83`), not just for freshly fetched ones. A repo carried forward from the baseline silently ages; recomputing keeps the Graveyard honest without re-fetching anything.

## Outputs

Written by `pipeline/buildIndex.ts` — see [Output Data Format](Output-Data-Format.md) for the shapes. Note the two caches it also refreshes:

- `cache/classifications.json` keeps classification cost from recurring ([Classification and Taxonomy](Classification-and-Taxonomy.md)).
- `cache/positions.json` keeps the layout stable between nights ([Graph Construction](Graph-Construction.md)).
