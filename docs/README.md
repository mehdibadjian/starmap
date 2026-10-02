# Starmap Documentation

Starmap turns one GitHub account's stars into a browsable, searchable, categorized library that runs entirely from static files. A nightly GitHub Action fetches, classifies, lays out, and publishes flat JSON; the browser does all filtering and searching locally. No server, no database, no runtime API calls.

These pages are the documentation set that lives in the repository, next to the code it describes — browse [`docs/`](.) in the file tree and GitHub renders this file as the folder landing page. Three sources, deliberately separate:

- **This directory** — how the system is built *today*. Describes the code, not the intention.
- **[`SPEC.md`](../SPEC.md)** — the original design document, including goals and milestones the code has not reached. Where the two disagree, the disagreement is recorded in [Known Gaps](Known-Gaps.md).
- **[`README.md`](../README.md)** — the short front door for someone forking the template.

Linking convention: page-to-page links are bare relative filenames (`Views.md`), so they resolve in a cloned checkout, in GitHub's file view, and in a wiki export alike. Source files are cited as inline code with a `file.ts:line` reference rather than as hyperlinks — that keeps the prose readable and survives a page moving between the repo and a wiki. The line numbers are a locator, not a contract: they were accurate when written and will drift as the code changes, so treat a mismatch as "read a little further along the file" rather than "this doc is wrong". The only upward links are the two to repository-root files above; if you publish this set as a GitHub wiki, copy `_Sidebar.md` into the wiki repo for the navigation rail and expect those two to need retargeting.

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
