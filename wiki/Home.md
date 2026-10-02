# Starmap Wiki

Starmap turns one GitHub account's stars into a browsable, searchable, categorized library that runs entirely from static files. A nightly GitHub Action fetches, classifies, lays out, and publishes flat JSON; the browser does all filtering and searching locally. No server, no database, no runtime API calls.

If you are reading this in the repository rather than the GitHub wiki, these files live in `wiki/` and the cross-page links below work as-is. In the wiki, navigate between pages from this index. `SPEC.md` in the repository root is the original design document; where the spec and the code disagree, the pages here describe the code and record the difference in [Known Gaps](Known-Gaps.md).

## Start here

| Page | Read it when |
|---|---|
| [Architecture](Architecture.md) | You want the one-screen mental model of CI → JSON → SPA. |
| [Forking a New Site](Forking-a-New-Site.md) | You are setting up your own copy. ~2 minutes, no secrets. |
| [Configuration](Configuration.md) | You need to change `config.yml` or the taxonomy. |
| [Local Development](Local-Development.md) | You want the pipeline and site running on your laptop. |
| [Troubleshooting](Troubleshooting.md) | Something failed: a 403, a blank page, a full pass every night. |

## The pipeline

| Page | Covers |
|---|---|
| [Data Pipeline](Data-Pipeline.md) | `npm run sync`, fetch, incremental vs. full pass, merge baseline. |
| [Classification and Taxonomy](Classification-and-Taxonomy.md) | Rules tier, opt-in LLM tier, the cache, taxonomy versioning. |
| [Graph Construction](Graph-Construction.md) | Nodes, edges, Jaccard similarity, pruning, precomputed layout. |
| [Output Data Format](Output-Data-Format.md) | Every file in `data/`, its shape, and who reads it. |
| [CI and Deployment](CI-and-Deployment.md) | `nightly.yml`, Pages constraints, the cache commit loop. |

## The site

| Page | Covers |
|---|---|
| [Frontend](Frontend.md) | Loading order, state-in-URL, keyboard control, perf budget. |
| [Views](Views.md) | Graph, List, Timeline, Graveyard, the repo panel. |
| [Theming and Tokens](Theming-and-Tokens.md) | Restyling without touching a component. |
| [Known Gaps](Known-Gaps.md) | Spec-vs-code differences and open items. |

## Core idea

Everything that costs time or money happens in CI. The client only reads flat files. That single constraint explains most of the design: precomputed coordinates instead of live physics, a prebuilt search index instead of a search server, sharded JSON instead of a database, relative paths instead of routes.

## At a glance

- **Repo:** `mehdibadjian/starmap` · static template, fork-and-run
- **Pipeline:** TypeScript + `tsx`, Octokit, MiniSearch, `d3-force` (headless), Anthropic SDK (opt-in)
- **Frontend:** Vite + React 18 + Tailwind + Radix UI, graph rendered on Canvas
- **CI:** one workflow, two sequential jobs (`build` → `deploy`); nightly cron + push + manual dispatch
- **Size:** 11 pipeline modules (~960 lines); graph/list/timeline/graveyard/panel/search components + `lib/` (~1,170 lines); `App.tsx` shell (~260); `ui/` primitives (~480); styles (~110)
- **Not present yet:** tests, lint config, `LICENSE` — see [Known Gaps](Known-Gaps.md)
