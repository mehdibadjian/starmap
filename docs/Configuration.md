# Configuration

## `config.yml`

```yaml
login: mb
title: "Starmap"
theme: dark
taxonomy: default        # or ./my-taxonomy.json
classifier: auto         # auto | rules | llm
schedule: "0 18 * * *"
exclude_forks: false
```

Parsed in `pipeline/config.ts` with defaults for everything except `login`, which throws if missing. A forker should only ever need to change `login`.

| Key | Default | Read by | Effect |
|---|---|---|---|
| `login` | **required** | fetch, graph, meta | Whose stars to sync; also the `root` node label. |
| `title` | `Starmap` | meta → header | Site title shown in the header. The `<title>` tag in `index.html` is static. |
| `theme` | `dark` | meta → `document.body` class | `dark` or `light`; see [Theming and Tokens](Theming-and-Tokens.md). |
| `taxonomy` | `default` | `taxonomyPath()` | `default` → `taxonomy.json`; otherwise a path to your own file. |
| `classifier` | `auto` | classify | `auto` / `rules` / `llm`; see [Classification and Taxonomy](Classification-and-Taxonomy.md). |
| `schedule` | `0 18 * * *` | **nothing** | Documentation only — see below. |
| `exclude_forks` | `false` | fetch | Drops repos the API marks as forks. |

There is no schema validation and no unknown-key warning: a typo like `exclude_forks: "false"` (a string) still loads, and `"false"` is truthy in the fetch filter. Edit carefully.

## `schedule` is a comment, not a setting

GitHub Actions cron expressions must be static in the workflow file, so `config.yml`'s `schedule` value is loaded and carried around but never used to configure anything. To change the cadence you must edit `cron:` in `.github/workflows/nightly.yml`, and keep the two in sync by hand.

Also note that a full pass (the one that detects unstars) is hardcoded to `now.getUTCDay() === 0` in `pipeline/fetch.ts` — moving the cron to a different hour does not move that.

## Environment variables

Not in `config.yml`, all read from the process environment:

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `GITHUB_TOKEN` | `sync.ts` | **yes** (throws) | Fetch stars. In CI it is the built-in `secrets.GITHUB_TOKEN`; locally, any token with public read access. |
| `ANTHROPIC_API_KEY` | `classify.ts` | no | Enables the LLM tier. Absent → rules-only + `llm_degraded: true`. |
| `FORCE_FULL` | `sync.ts` | no | `1` forces a full pass — the manual "pick up unstars now" switch. |
| `GITHUB_REPOSITORY` | `previousData.ts` | implicit in CI | Used to derive the Pages URL for the merge baseline. |
| `PAGES_URL` | `previousData.ts` | no | Overrides the derived Pages URL. Useful for custom domains or after a rename. |

## `taxonomy.json`

```json
{ "version": 1, "roots": [ { "id": "devtools", "label": "Devtools",
  "leaves": [ { "id": "devtools/cli", "label": "CLI / TUI",
                "topics": ["cli", "command-line", "terminal", "tui", "shell"],
                "langs": ["Rust"] } ] } ] }
```

- Leaf `id`s must be `root/leaf` — the UI splits them on `/` for breadcrumbs and the graph prefixes them as `leaf:<id>`.
- `topics` drive the rules tier; add keywords there to improve free coverage before reaching for the LLM.
- `langs` is optional and worth `+1` in the rules score (a topic is worth `+2`).
- **Bump `version` when you change the tree.** That is the only mechanism that invalidates `cache/classifications.json` wholesale. Without it, renamed or removed leaves leave stale category IDs pointing at nodes that no longer exist.
- Keep a `misc/other` leaf: it is the unmatched fallback in the rules tier, the extra value in the LLM enum, and the parent used for any repo with no categories when building graph edges.

## Build-time configuration

`vite.config.ts` sets `base: "./"` — this is load-bearing, not a style choice. Project Pages sites serve from `/<repo>/`, and any absolute asset path breaks every fork under a different name. The frontend fetches data with relative paths (`./data/graph.json`) for the same reason. Do not change `base` without also checking the deploy.

`pipeline/tsconfig.json` and `tsconfig.json` are separate: `src` compiles against DOM, `pipeline` against Node. `npm run typecheck` runs both.
