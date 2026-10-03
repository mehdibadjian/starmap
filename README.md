# Starmap

A static, forkable site that turns a GitHub account's stars into a browsable, searchable, categorized library. No server, no database, no runtime API calls — a nightly GitHub Action fetches, classifies, and publishes flat JSON; the browser does everything else locally.

## Documentation

Full documentation lives in [`docs/`](./docs), rendered from the current code:

| I want to… | Read |
|---|---|
| understand how it fits together | [Architecture](./docs/Architecture.md) |
| publish my own copy | [Forking a New Site](./docs/Forking-a-New-Site.md) |
| change categories or behaviour | [Configuration](./docs/Configuration.md), [Classification and Taxonomy](./docs/Classification-and-Taxonomy.md) |
| hack on it locally | [Local Development](./docs/Local-Development.md) |
| follow the data | [Data Pipeline](./docs/Data-Pipeline.md), [Output Data Format](./docs/Output-Data-Format.md), [Graph Construction](./docs/Graph-Construction.md) |
| understand CI | [CI and Deployment](./docs/CI-and-Deployment.md) |
| work on the UI | [Frontend](./docs/Frontend.md), [Views](./docs/Views.md), [Theming and Tokens](./docs/Theming-and-Tokens.md) |
| fix something that broke | [Troubleshooting](./docs/Troubleshooting.md) |
| see what's still wrong | [Known Gaps](./docs/Known-Gaps.md) |

The index is [`docs/README.md`](./docs/README.md). See [`SPEC.md`](./SPEC.md) for the original design document; where spec and code disagree, the docs pages describe the code and log the difference.

## Fork checklist (~2 minutes)

1. **Use this template** to create your own repository.
2. Edit `config.yml`:
   ```yaml
   login: your-username
   ```
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. **Settings → Actions → General → Workflow permissions → "Read and write permissions."** The nightly job commits `cache/classifications.json`, `cache/positions.json`, and `LAST_SYNC` back to the repo — without write permission that push step 403s.
5. **Actions → "Starmap sync + deploy" → Run workflow** (manual first run — this is also what creates the `github-pages` deployment environment).

That's it — no secrets required. `GITHUB_TOKEN` is provided automatically by Actions. The site classifies with the built-in rules tier and deploys to your Pages URL, shown afterward under Settings → Pages.

The workflow also runs automatically on every push to `main` (in addition to the nightly cron and manual dispatch), so merging changes redeploys the site. Commits the workflow itself makes (the cache/`LAST_SYNC` commit above) are authored via `GITHUB_TOKEN` and — per GitHub's own behavior — do not trigger another run, so there's no push loop.

### Optional: LLM enrichment

Add an `ANTHROPIC_API_KEY` repository secret (Settings → Secrets and variables → Actions → New repository secret) to enable the LLM classification tier (blurbs, tags, better category coverage on sparse repos). Without it, the site runs rules-only with a visible "rules-only" badge in the header — nothing breaks.

You can tell how much the missing tier is costing you: when 10% or more of your stars land in "misc / other", the header shows `N% uncategorised`, and its tooltip names the two fixes — add the key, or extend `taxonomy.json` with the topics and languages your collection actually uses.

## Local development

```bash
npm install
GITHUB_TOKEN=<a token with public repo read access> npm run sync   # populates public/data/
npm run dev                                                        # frontend at localhost:5173
npm run lint && npm run typecheck && npm test                       # 40 node:test cases, no test framework
npm run fixture && npm run build && npm run smoke                   # browser checks over CDP, no token needed
```

`npm run sync` is the single pipeline entrypoint — fetch → classify → enrich → build graph → build search index → write shards. It's the same command CI runs nightly. All four gates above run in CI: `lint`, `typecheck`, and `test` on every pull request *and* before every deploy; `smoke` in a dedicated browser job (`ci.yml`). To work on the UI without a token, `npm run fixture` writes a synthetic dataset through the real pipeline. See [Local Development](./docs/Local-Development.md).

## How it stays in sync

- **Nightly**, the workflow fetches new stars (stopping at the first repo it already knows), classifies just the new ones, and republishes.
- **Weekly (Sunday)**, it does a full pass to also detect unstars.
- `data/` itself is never committed — it's a build artifact regenerated into the Pages deploy each run. The two things kept in git are `cache/classifications.json` (the LLM cache, so re-runs don't re-pay classification cost) and `cache/positions.json` (previous graph layout, so nightly additions perturb the map locally instead of reshuffling it). Since `data/` isn't committed, the pipeline fetches the *previous* night's published dataset straight from the live Pages site as its merge baseline — this is why the very first run (or a run against an unreachable/not-yet-deployed site) always does a full pass.

## Stack

- **Pipeline** (`pipeline/`): TypeScript + `tsx`, Octokit, MiniSearch, `d3-force` (headless layout), the Anthropic SDK for the opt-in LLM tier.
- **Frontend** (`src/`): Vite + React + Tailwind. Graph view renders on Canvas (SVG falls over past ~2k nodes).
- **CI**: two GitHub Actions workflows. `ci.yml` validates on pull requests — lint, type-check, unit tests, and a browser job that drives the built site over CDP. `nightly.yml` runs sync, build, and `deploy-pages` as sequential jobs in one workflow, because commits authored by `GITHUB_TOKEN` don't trigger new workflow runs. It gates the deploy on the same checks, and **Run workflow** has a `full_pass` checkbox to force a full re-walk on demand.

## Config surface (`config.yml`)

```yaml
login: your-username
title: "Starmap"
theme: dark
taxonomy: default        # or ./my-taxonomy.json
classifier: auto         # auto | rules | llm
schedule: "0 18 * * *"
exclude_forks: false
```

`schedule` documents the intended cadence; GitHub Actions cron triggers must be static in the workflow file, so changing the cadence also means editing the `cron:` line in `.github/workflows/nightly.yml`.

## Taxonomy

`taxonomy.json` is versioned (`version` field). Bump it to force a full reclassification — otherwise the LLM cache treats existing classifications as still valid. Fork your own by pointing `config.yml`'s `taxonomy` at a different file.

## License

MIT — see [LICENSE](./LICENSE). Forking and reusing this is the point of it: keep the copyright and permission notice, do whatever you like with the rest. Your star list, your copy.
