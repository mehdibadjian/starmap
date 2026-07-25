# Starmap

A static, forkable site that turns a GitHub account's stars into a browsable, searchable, categorized library. No server, no database, no runtime API calls — a nightly GitHub Action fetches, classifies, and publishes flat JSON; the browser does everything else locally.

See [`SPEC.md`](./SPEC.md) for the full design.

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

## Local development

```bash
npm install
GITHUB_TOKEN=<a token with public repo read access> npm run sync   # populates public/data/
npm run dev                                                        # frontend at localhost:5173
```

`npm run sync` is the single pipeline entrypoint — fetch → classify → enrich → build graph → build search index → write shards. It's the same command CI runs nightly.

## How it stays in sync

- **Nightly**, the workflow fetches new stars (stopping at the first repo it already knows), classifies just the new ones, and republishes.
- **Weekly (Sunday)**, it does a full pass to also detect unstars.
- `data/` itself is never committed — it's a build artifact regenerated into the Pages deploy each run. The two things kept in git are `cache/classifications.json` (the LLM cache, so re-runs don't re-pay classification cost) and `cache/positions.json` (previous graph layout, so nightly additions perturb the map locally instead of reshuffling it). Since `data/` isn't committed, the pipeline fetches the *previous* night's published dataset straight from the live Pages site as its merge baseline — this is why the very first run (or a run against an unreachable/not-yet-deployed site) always does a full pass.

## Stack

- **Pipeline** (`pipeline/`): TypeScript + `tsx`, Octokit, MiniSearch, `d3-force` (headless layout), the Anthropic SDK for the opt-in LLM tier.
- **Frontend** (`src/`): Vite + React + Tailwind. Graph view renders on Canvas (SVG falls over past ~2k nodes).
- **CI**: a single GitHub Actions workflow — sync, build, and `deploy-pages` run as sequential jobs, because commits authored by `GITHUB_TOKEN` don't trigger new workflow runs.

## Config surface (`config.yml`)

```yaml
login: mb
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
