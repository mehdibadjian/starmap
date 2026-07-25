# Starmap — Spec

A static, forkable site that turns a GitHub account's stars into a browsable, searchable, categorized library. No server, no database, no runtime API calls.

---

## 1. Goals / Non-goals

**Goals**
- Nightly sync of one account's stars into versioned JSON.
- Categorization into a stable taxonomy (tree) + relatedness edges (graph view).
- Instant client-side search and faceting over thousands of records.
- Surface decay: archived, dead, and superseded repos.
- Fork → edit one config value → live site. No secrets required for the baseline path.

**Non-goals**
- Multi-user hosting or auth.
- Writing back to GitHub (unstarring, list management).
- Real-time freshness. Nightly is the contract.
- Reading private stars of other accounts.

---

## 2. Architecture

```
GitHub Actions (cron, nightly)
  └─ fetch      → raw stars via REST
  └─ diff       → added / removed / changed since last run
  └─ classify   → new repos only (rules → optional LLM)
  └─ enrich     → health metrics, graph edges
  └─ build      → search index + sharded JSON
  └─ publish    → commit data + deploy GitHub Pages

Browser
  └─ static SPA, fetches JSON shards, all filtering/search local
```

Everything that costs time or money happens in CI. The client only reads flat files.

---

## 3. Data pipeline

### 3.1 Fetch
- `GET /users/{login}/starred?per_page=100`, header `Accept: application/vnd.github.star+json` to get `starred_at` alongside the repo object.
- Results are ordered by star date descending → **incremental mode** can stop at the first known repo ID.
- **Full pass weekly** (Sunday) to detect unstars, which incremental mode cannot see.
- Auth: the fork's built-in `GITHUB_TOKEN`. 5,000 req/hr, 100 records/req. 5,000 stars ≈ 50 requests. Rate limits are a non-issue.
- Retry with exponential backoff on 403/429; abort the run without committing on partial failure. Never publish a truncated dataset.

### 3.2 Repo record
The API response already carries nearly everything. Store a trimmed projection:

```json
{
  "id": 28457823,
  "nwo": "owner/name",
  "desc": "…",
  "lang": "TypeScript",
  "topics": ["cli", "developer-tools"],
  "stars": 12043,
  "forks": 812,
  "license": "MIT",
  "archived": false,
  "is_fork": false,
  "pushed_at": "2026-03-14",
  "created_at": "2019-02-01",
  "starred_at": "2024-11-02",
  "homepage": "https://…",
  "cat": ["devtools/cli"],
  "tags": ["rust", "terminal", "tui"],
  "blurb": "Normalized one-liner, ≤90 chars",
  "health": { "stale_days": 512, "state": "stale" }
}
```

`health.state` ∈ `active | slowing | stale | dead | archived`, derived from `pushed_at` and `archived` with fixed thresholds (90 / 365 / 730 days).

### 3.3 Classification
Two-tier, so the project works with zero secrets:

1. **Rules tier (always on).** `taxonomy.json` maps GitHub topics and languages to categories. Deterministic, free, ~60–70% coverage on well-tagged repos. Unmatched → `unsorted`.
2. **LLM tier (opt-in).** If `ANTHROPIC_API_KEY` exists, classify only records absent from `data/classifications.json`, batched ~25 repos per call, constrained to the taxonomy leaf list, returning `{id, cat[], tags[], blurb}` as JSON. Results are cached by `id + sha1(desc + topics)` so re-runs cost nothing and a description edit triggers reclassification.

Backlog cost for the first run is a one-off. Steady state is a handful of new repos per night.

**Taxonomy is pinned and versioned.** A `version` field in `taxonomy.json`; bumping it invalidates the cache and forces a full reclassification. Without this, categories drift and the tree becomes noise.

Suggested root buckets (≤12, each with 3–8 leaves): `ai-ml`, `devtools`, `web`, `backend`, `data`, `infra-devops`, `security`, `mobile-desktop`, `languages-compilers`, `learning-reference`, `design-media`, `misc`.

### 3.4 Graph construction
The graph is the presentation layer, not a datastore. It is built entirely in CI and shipped as coordinates.

**Nodes**
- Synthetic `root` node (the account).
- One hub node per taxonomy root (~12).
- One node per taxonomy leaf.
- One node per repo.

**Edges**
- Structural: `root → hub → leaf → repo`. This is the navigation spine.
- Associative: repo ↔ repo, weight = Jaccard similarity on topic sets, boosted for same owner and same language. **Prune to top 6 per node** and drop below-threshold weights. Unpruned, a few thousand nodes render as an unreadable hairball.

**Layout is precomputed.** Run `d3-force` headless in the nightly job until the simulation settles, then persist `x`/`y` per node into `graph.json`. Two reasons this is non-negotiable:
1. The client paints immediately instead of spending several seconds settling physics.
2. Positions stay stable between visits, so the user learns the map. A graph that re-jitters on every load cannot be memorized, and an unmemorizable map is not navigation.

Seed the simulation with the previous run's coordinates so nightly additions perturb the layout locally rather than reshuffling it.

```json
{
  "nodes": [
    { "id": "hub:devtools", "kind": "hub", "label": "Devtools", "count": 218, "x": -140, "y": 62 },
    { "id": "repo:28457823", "kind": "repo", "parent": "leaf:devtools/cli", "x": -151, "y": 74 }
  ],
  "edges": [
    { "s": "leaf:devtools/cli", "t": "repo:28457823", "kind": "struct" },
    { "s": "repo:28457823", "t": "repo:9912004", "kind": "assoc", "w": 0.42 }
  ]
}
```

---

## 4. Output layout

```
data/
  meta.json           # login, counts, last_sync, taxonomy_version
  repos/000.json …    # shards of ~500 records
  search.json         # prebuilt MiniSearch index
  graph.json          # nodes + pruned edges
  classifications.json# LLM cache (committed)
  history.json        # daily {date, total, added, removed} for the timeline
```

**Data is not committed.** Because Pages deploys from an Actions artifact, the nightly job generates `data/` into the upload directory and publishes it. The artifact is not git, so nightly regeneration adds no repository history and the bloat problem does not exist.

The only committed outputs are small and text-shaped:
- `cache/classifications.json` — the LLM cache. Must persist across runs or every night pays full classification cost.
- `cache/positions.json` — previous graph coordinates, used to seed the next layout.
- `LAST_SYNC` — one line. Also serves as repository activity, see §9.

### 4.1 GitHub Pages constraints

- **Relative paths everywhere.** Project pages serve from `/<repo>/`, user pages from `/`. Vite `base: './'`, and all data fetches relative (`./data/graph.json`). Any absolute path breaks the moment someone forks under a different repo name. This is the most common fork-breaking bug in template repos.
- **No server rewrites.** Deep links must live in the hash or query string (`#/devtools/cli?q=tui`), never in the path, or a refresh 404s.
- **Single workflow.** Commits authored by `GITHUB_TOKEN` do not trigger other workflows. A separate `on: push` deploy job will never fire. Sync, build, and `deploy-pages` run as sequential jobs in one workflow.
- Add `.nojekyll` so underscore-prefixed files are served.
- **[Likely] Soft limits:** ~1 GB published site, ~100 GB/month bandwidth, ~10 builds/hour. A nightly build against a few thousand repos is nowhere near any of these.

---

## 5. UI

The graph is the primary surface. The design principle borrowed from Neo4j Browser: **it only ever feels navigable because every view is a small query result.** It never renders the whole database at once, and neither does this.

### 5.1 Graph view (default)

**Progressive disclosure**
- Cold load renders `root` + ~12 category hubs. Nothing else.
- Click a hub → its leaves expand, other hubs dim and collapse.
- Click a leaf → its repos fan out. Breadcrumb trail shows the path; Escape walks back up.
- Associative edges render only between currently visible nodes, so the hairball can never form.
- Hard cap of ~250 visible nodes. Beyond that, cluster the overflow into a single "+N more" node that expands into a list panel.

**Rendering**
- Canvas or WebGL. SVG dies past roughly 1,500 elements.
- Node size by star count (log scale), color by category, ring by health state.
- Labels on hover, on selection, or above a zoom threshold. Never all at once.
- Hover → tooltip with blurb, language, stars, last push. Click-through on the selection panel, not on the node itself.

**Search drives the graph**
`/` focuses the search box. Typing filters against the MiniSearch index; matching nodes pulse, the path from root auto-expands, and the camera flies to the result set. This is the Cypher-query equivalent — search is not a separate tab, it is how you move through the graph.

### 5.2 Supporting views
- **List.** The same filtered set as a dense table, for when you know what you want. Toggle with `l`.
- **Timeline.** Stars per month; reveals phases of interest.
- **Graveyard.** Archived + dead only. The highest-value page in the app.

### 5.3 Behavior
- Static `index.html`. The nightly job rewrites only `data/*.json` — never the HTML. Clean diffs, cached app shell, no rebuild.
- URL-encoded state (expanded path, query, view) so any view is shareable and back/forward work.
- Keyboard-first: `/` search, `Esc` collapse, `l` list toggle, `Enter` open repo, `f` fit-to-view.
- Perf budget: under 2s to interactive on 4G, under 3MB initial payload. Load `graph.json` + search index first, repo shards during idle time.

**Aesthetic direction:** dense and typographic, not card-soup. Monospace for identifiers, a real typeface for prose, one accent color, generous whitespace, dark mode default. Theme lives in a single token file so forkers can restyle without touching components.

---

## 6. Portability

Fork checklist, target: under 2 minutes.
1. Use the template repo.
2. Edit `config.yml` → `login: your-username`.
3. Enable Pages (source: Actions).
4. Run the workflow manually once.

Config surface:
```yaml
login: mb
title: "Starmap"
theme: dark
taxonomy: default        # or ./my-taxonomy.json
classifier: auto         # auto | rules | llm
schedule: "0 18 * * *"
exclude_forks: false
```

Rules: no hardcoded username anywhere; missing `ANTHROPIC_API_KEY` degrades to rules-only with a visible notice rather than failing; the first run must produce a working site with zero secrets configured.

---

## 7. Stack

- Fetch/build: TypeScript + `tsx`, Octokit, MiniSearch. Single `npm run sync` entrypoint, runnable locally.
- Frontend: Vite + React + Tailwind. Graph via `d3-force` on canvas (SVG dies past ~2k nodes).
- CI: GitHub Actions, `actions/deploy-pages`.

---

## 8. Milestones

| # | Deliverable | Definition of done |
|---|---|---|
| M0 | Fetch + commit | `data/repos/*.json` populated nightly |
| M1 | Rules classifier + Library view | Faceted search over all stars, deployed |
| M2 | Health + Graveyard | Dead repos identified and listed |
| M3 | LLM enrichment | Blurbs, tags, `unsorted` under 10% |
| M4 | Graph + Timeline | Pruned graph renders under 100ms/frame |
| M5 | Template hardening | A clean fork works on a different account, untouched |

Ship M1 before touching the graph. If M1 doesn't get used within two weeks, the graph won't save it.

---

## 9. Risks

- **[Likely] The graph is decoration.** Node-link diagrams over thousands of nodes are demos, not tools. Facets do the actual work. Budget accordingly.
- **[Likely] Taxonomy drift.** Unpinned LLM labeling produces near-duplicate categories. Constrain to a fixed leaf list; never let the model invent categories.
- **[Certain] Git history bloat** from nightly data commits. See §4.
- **[Guessing] Classification quality on sparse repos.** Repos with no topics and a one-word description will land in `unsorted` regardless of tier. Accept a floor of ~5%.
- **[Likely] Abandonment.** The mitigation isn't a nicer UI — it's making the site the default answer to "what was that library I saved?" That means fast search and a browser-searchable URL, not a landing page.
