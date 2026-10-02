# Architecture

Starmap is two programs that talk only through JSON files.

```
                    GitHub Actions (nightly cron, push, manual)
                    ┌─────────────────────────────────────────────┐
                    │ npm run sync  → pipeline/sync.ts            │
   GitHub REST ───► │  fetch → classify → enrich → graph → build  │───► public/data/*.json
                    └─────────────────────────────────────────────┘        │
                                                                           ▼
                                              npm run build (vite) → dist/ ─► Pages artifact
                                                                           ▲
                    cache/classifications.json ──┐                         │
                    cache/positions.json ────────┴─ committed back each run│
                                                                           │
                    Browser ────────────────────────────────────────────────┘
                    static SPA: reads ./data/*.json, all search + filter local
```

## The two halves

**Pipeline (`pipeline/`, 11 modules, ~960 lines, Node 22 + `tsx`).** Runs in CI. Reads the star list, classifies new repos, computes health, builds the graph and its coordinates, and writes a directory of flat JSON. It is a batch job with no UI and no server state.

**Frontend (`src/`, ~1.4k lines of app code plus ~480 lines of `ui/` primitives, Vite + React + Tailwind).** A plain SPA. It fetches `meta.json`, `graph.json`, and the prebuilt search index first, then loads repo shards during browser idle time. Every interaction — search, facet, drill-down, selection — is local computation over data already in memory.

## What lives where

| Path | Tracked in git | Purpose |
|---|---|---|
| `config.yml` | yes | The only file a forker must edit. |
| `taxonomy.json` | yes | Versioned category tree + rules-tier keyword lists. |
| `pipeline/*.ts` | yes | The nightly batch job. |
| `src/**` | yes | The SPA. |
| `public/.nojekyll` | yes | Stops Pages from filtering underscore-prefixed files. |
| `public/data/` | **no** (gitignored) | Generated dataset; ends up in the deploy. |
| `cache/classifications.json` | yes | LLM/rules cache so re-runs don't re-pay cost. |
| `cache/positions.json` | yes | Last layout, seeds the next one. |
| `LAST_SYNC` | yes | One ISO timestamp; also repo activity. |
| `.github/workflows/nightly.yml` | yes | Sync → build → deploy in one workflow. |

## Decisions worth knowing

**Everything expensive happens in CI.** Layout physics, search indexing, and classification are the three things that would be slow or costly in a browser. All three are done nightly and shipped as results.

**`data/` is not in git.** Pages deploys from an Actions artifact, so the dataset regenerates without adding repository history. The trade-off: the previous night's dataset only exists on the live site, so the pipeline fetches its own merge baseline over HTTP — see [Data Pipeline](Data-Pipeline.md).

**The graph is a presentation layer, not a datastore.** It ships as coordinates. Nodes are the taxonomy plus one per repo; repo data itself lives in the shards.

**No hardcoded username anywhere.** `config.yml`'s `login` is read at pipeline time; the account name reaches the UI only through `meta.json`. Combined with Vite's `base: './'` and hash-based routing, that is what makes a fork work under an arbitrary repository name.

**Graceful degradation is a feature.** Without `ANTHROPIC_API_KEY` the site runs rules-only and shows a `rules-only` badge in the header rather than failing — see [Classification and Taxonomy](Classification-and-Taxonomy.md).

## Next

- New to the repo → [Forking a New Site](Forking-a-New-Site.md)
- Changing behavior → [Configuration](Configuration.md)
- Debugging a run → [Troubleshooting](Troubleshooting.md)
