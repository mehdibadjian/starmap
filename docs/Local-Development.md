# Local Development

## Setup

```bash
npm install
GITHUB_TOKEN=<token with public repo read access> npm run sync   # writes public/data/
npm run dev                                                     # http://localhost:5173
```

`npm run sync` is the same command CI runs nightly — fetch → classify → enrich → build graph → build search index → write shards. There is no separate "generate fixtures" step.

For the token, a classic PAT with no scopes beyond public read, or `gh auth token`, is enough: the pipeline only calls `GET /users/{login}/starred`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server. Reads `public/data/` as-is — no pipeline watching. |
| `npm run build` | `tsc -p tsconfig.json --noEmit` then `vite build` → `dist/`. |
| `npm run preview` | Serve `dist/` locally, closest thing to the real Pages deploy. |
| `npm run sync` | Run the whole pipeline once. |
| `npm run typecheck` | Type-check `src` (DOM) **and** `pipeline` (Node) separately. |

There is no test runner and no linter configured — see [Known Gaps](Known-Gaps.md). `npm run typecheck` is the only automated correctness gate.

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
