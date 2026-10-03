# Local Development

## Setup

```bash
npm install
GITHUB_TOKEN=<token with public repo read access> npm run sync   # writes public/data/
npm run dev                                                     # http://localhost:5173
```

`npm run sync` is the same command CI runs nightly — fetch → classify → enrich → build graph → build search index → write shards. There is no separate "generate fixtures" step.

For the token, a classic PAT with no scopes beyond public read, or `gh auth token`, is enough: the pipeline only calls `GET /users/{login}/starred`.

## Without a token

The frontend reads only `public/data/`, so you can develop the UI against a synthetic dataset instead of a real star list. Build one by driving the pipeline's own functions — `loadTaxonomy`/`leafIds`, `computeHealth`, `buildGraph`, `buildOutputs` — over a hand-written array of ~75 fake repos, and write the result to `public/data/`. Doing it that way matters: a hand-authored JSON blob won't exercise the shard splitting, the search-index serialization, or the graph's node IDs, and those are exactly the seams that break.

Whatever you generate lands in `public/data/`, which is gitignored — so the repo never carries a fake dataset, and `npm run sync` overwrites it with a real one.

Two traps worth knowing before you write the generator:

- **Keep the fixture's words distinct.** If every fake description contains the string you later search for, a "topics are indexed too" test proves nothing. Give each record a topic that appears nowhere else in it.
- **Derive `cat` from real leaf IDs.** A `cat: [null]` from an off-by-one in the generator is the fastest way to conclude the SPA is broken when the data is. The client now filters such rows out rather than blanking, but you'll be debugging the wrong thing.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server. Reads `public/data/` as-is — no pipeline watching. |
| `npm run build` | `tsc -p tsconfig.json --noEmit` then `vite build` → `dist/`. |
| `npm run preview` | Serve `dist/` locally, closest thing to the real Pages deploy. |
| `npm run sync` | Run the whole pipeline once. |
| `npm test` | `node --import tsx --test "tests/*.test.ts"` — 31 tests, no test framework. |
| `npm run typecheck` | Type-checks `src` (DOM), `pipeline` (Node), and `tests` as three separate projects. |

The test runner is Node 22's built-in `node:test` with `tsx` as a loader, so there is nothing new to install and no config file. Notes on making it work:

- Pass the quoted glob, `node --test "tests/*.test.ts"`. A bare directory argument makes Node treat it as a module and fail with `ERR_MODULE_NOT_FOUND`.
- `tests/tsconfig.json` is its own project: Node globals for the runner, DOM lib for the browser-facing code under test, `allowImportingTsExtensions` because the suite imports `.ts` sources directly. It needs no `jsx` — the tests exercise functions, not components.
- Tests import from `@/` and `@shared/`, which resolve via the `paths` mirrors — the same aliases Vite uses, so a test and the browser agree on what a module is.

What the suite covers, in order of the harm it prevents: the MiniSearch serialize → rehydrate → query round trip (gap 1), `readCanvasTheme()` against the real `tokens.css` (gap 2 and the `<html>` scope), `planClassifications`' pending-hash retry rule (gap 4), `computeHealth` threshold edges, `parseHash`/`buildHash` round trips, and the shard row guard. None of them need a browser or a network.

There is still no linter configured — see [Known Gaps](Known-Gaps.md). `npm run typecheck` and `npm test` are the automated correctness gates, and neither runs in CI yet.

## Working on the pipeline

The pipeline is plain ESM TypeScript run through `tsx`, so each stage is independently readable and the module boundaries are the seams:

```
config.ts        → load config.yml
taxonomyRules.ts → load taxonomy.json, rules-tier match
fetch.ts         → Octokit, paging, retry, incremental stop
classify.ts      → cache + rules + optional LLM
enrich.ts        → RawStar + classification → RepoRecord
health.ts        → pushed_at/archived → state
graph.ts         → nodes, edges, headless layout, positions
buildIndex.ts    → shards, search index, meta, history
previousData.ts  → merge baseline from the live Pages site
sync.ts          → the orchestrator
```

Useful local flags:

```bash
FORCE_FULL=1 npm run sync     # ignore incremental, walk everything
npm run sync                  # re-runs are cheap: cache hits, no LLM spend
```

To test baseline fetching offline, set `PAGES_URL` to a deployed site — or let it fail, which is a valid path and forces a full pass.

`public/data/` is gitignored. Delete it to confirm your code handles a cold start, and delete `cache/positions.json` to force a fresh layout.

## Working on the frontend

`src/lib/data.ts` fetches with relative `./data/...` paths, so the dev server needs the generated dataset present. If you edit only components, run `sync` once and then never again.

Loading order is intentional and easy to break: `meta.json`, `graph.json`, and `search.json` load on mount; repo shards load one at a time in `requestIdleCallback`. If you add a component that needs the full repo list, it will race that idle loading — `ListView` and `Graveyard` are empty until shards land.

To see a real deploy locally:

```bash
npm run sync && npm run build && npm run preview
```

`preview` is the check for path and `.nojekyll` problems that `dev` hides.

## Debugging a sync

The log line at the end tells you most of what you need:

```
Synced 1204 repos (added 7, removed 0, full=false, llm_degraded=true)
```

Anything thrown earlier aborts before writing output — the run exits non-zero and publishes nothing, by design. See [Troubleshooting](Troubleshooting.md) for the common causes.
