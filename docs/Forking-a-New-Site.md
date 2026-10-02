# Forking a New Site

Target: under two minutes, no secrets.

## Checklist

1. **Use this template** to create your own repository.
2. Edit `config.yml`:
   ```yaml
   login: your-username
   ```
   Every other key is optional — see [Configuration](Configuration.md).
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.** If you leave it on "Deploy from a branch", nothing ever publishes.
4. **Settings → Actions → General → Workflow permissions → "Read and write permissions."** The nightly job commits `cache/classifications.json`, `cache/positions.json`, and `LAST_SYNC` back to the repo. Without write permission that step 403s and the run fails.
5. **Actions → "Starmap sync + deploy" → Run workflow.** Run it manually once. This also creates the `github-pages` deployment environment.

Step 5 is the one people skip: workflow permissions only apply to runs started after the setting changed, and the first run is what produces the baseline `data/` on Pages.

## What the first run does

- The pipeline cannot reach a published site yet, so `fetchPreviousDataset()` throws, the run logs `No previous dataset available, running a full pass`, and it walks your whole star list.
- Every repo is classified by the rules tier. With no `ANTHROPIC_API_KEY`, that is the final answer.
- `graph.json` gets laid out from scratch (no previous positions to seed from) and `cache/positions.json` is written for next time.
- `dist/` is uploaded and `deploy` publishes it. Your URL appears under Settings → Pages.

## Verify

```bash
curl -s <pages-url>/data/meta.json | head -c 400
```

You should see your `login`, your `title`, a non-zero `total`, and `shard_count`. Then open the site and press `/` and search for something you know you starred.

## Optional: LLM enrichment

Add an `ANTHROPIC_API_KEY` repository secret (Settings → Secrets and variables → Actions → New repository secret) to turn on the second classification tier: better blurbs, tags, and coverage on repos with no topics. Set `classifier: auto` (the default) or `llm`. Re-run the workflow afterwards.

Cost is a one-off on the backlog: the result is cached in `cache/classifications.json`, committed to the repo, so later runs only pay for genuinely new or edited repos. Rules-only never breaks — the difference is category quality.

## Staying in sync

| Trigger | Effect |
|---|---|
| Nightly cron (`0 18 * * *`) | Incremental fetch — stops at the first repo it already knows. |
| Sunday (UTC) | Full pass, which also detects unstars. |
| Push to the default branch | Rebuild and redeploy. |
| Manual dispatch | Anything, on demand. |

Cache commits made by the workflow are authored by `GITHUB_TOKEN` and, per GitHub's own behavior, do not trigger another run — so there is no push loop.

## Renaming or moving your fork

The Pages URL is derived from `GITHUB_REPOSITORY` in `pipeline/previousData.ts`. After a rename, the first run fetches the *old* URL as its baseline, fails, and does a full pass. That is expected and harmless — but note that `history.json` is only carried forward from the baseline, so the timeline restarts. Set `PAGES_URL` explicitly if you want to control this.
