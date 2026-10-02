# CI and Deployment

One workflow: `.github/workflows/nightly.yml` (in the repository root), name **"Starmap sync + deploy"**.

## Triggers

```yaml
on:
  push:
    branches: [main]
  schedule:
    - cron: "0 18 * * *"      # 18:00 UTC nightly
  workflow_dispatch: {}
```

Note the push trigger is hardcoded to `main`. Work on a feature branch syncs nothing and deploys nothing until it merges — which is what you want, but it means a branch-based first run must be started with **Run workflow**.

Cron must stay static here; `config.yml`'s `schedule` is documentation only. See [Configuration](Configuration.md).

## Permissions

```yaml
permissions:
  contents: write      # push cache/classifications.json back
  pages: write        # upload + deploy the artifact
  id-token: write     # required by deploy-pages
concurrency:
  group: "pages"
  cancel-in-progress: false
```

`cancel-in-progress: false` matters: a manual run started while the nightly is publishing waits rather than killing it, so two runs never race the same environment.

The nightly job commits `cache/classifications.json`, `cache/positions.json`, and `LAST_SYNC` back to the branch. Set **Settings → Actions → General → Workflow permissions → "Read and write permissions"** on your fork. The workflow's own `contents: write` declares the need, but the repository-level setting must allow it — without that, the commit step fails with a 403 and the run never reaches the deploy.

## Jobs

### `build`

1. `actions/checkout@v4`
2. `actions/setup-node@v4` — Node 22, `cache: "npm"`
3. `npm ci`
4. `npm run sync` with `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}`
5. `npm run build`
6. Commit and push the caches (below)
7. `actions/upload-pages-artifact@v3` with `path: dist`

Step 5 also runs `tsc -p tsconfig.json --noEmit` — a type error in `src` fails the deploy. Note it checks only `src`: `pipeline/**` and `tests/**` are type-checked by `npm run typecheck`, and the suite runs under `npm test`; the workflow calls neither, so a broken cache rule or a failed regression test still deploys. See [Known Gaps](Known-Gaps.md).

The `sync` step happens **before** `build`, which is what puts `public/data/` on disk so Vite copies it into `dist/`. Swap those two and you publish an empty dataset with no error.

### The commit step

```bash
git config user.name  "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add cache/classifications.json cache/positions.json LAST_SYNC
git diff --cached --quiet || git commit -m "chore: nightly star sync"
git push origin HEAD:${{ github.ref_name }}
```

Three details worth knowing:

- `git diff --cached --quiet ||` makes a no-change run a no-op instead of an empty commit. Because the caches change whenever stars change, most nights do commit (visible in `git log` as a run of `chore: nightly star sync`).
- `HEAD:${{ github.ref_name }}` is explicit because `actions/checkout` leaves a **detached HEAD** — pushing to a branch without an upstream would otherwise fail.
- Commits authored by `GITHUB_TOKEN` do not trigger other workflows, so this push does not re-enter the `on: push` trigger. No loop. If you split deploy into a second workflow triggered by `push`, that deploy job will silently never fire — this is why sync, build, and deploy are one workflow.

### `deploy`

```yaml
needs: build
environment:
  name: github-pages
  url: ${{ steps.deployment.outputs.page_url }}
steps:
  - uses: actions/deploy-pages@v4
```

The `github-pages` environment is created by the first successful deploy. The `url` output is what appears as the site link on the run page and under Settings → Pages.

## GitHub Pages constraints that shaped the code

| Constraint | How the repo handles it |
|---|---|
| Project pages serve from `/<repo>/` | `base: "./"` in `vite.config.ts`; every data fetch is relative (`./data/meta.json`). |
| No server rewrites | All UI state lives in the hash — `#/devtools/cli?q=tui`. Never in a path. |
| Jekyll ignores underscore-prefixed files | `public/.nojekyll`, which Vite copies into the artifact. |
| Token commits don't chain workflows | Single workflow with sequential jobs. |
| Artifact, not a branch | `data/` never enters git history. |

A relative-path slip is the classic fork-breaking bug: it works on `owner/starmap` and 404s on any other repo name. `npm run preview` locally is a decent proxy for catching it; the dev server is not, because it serves from `/`.

## Soft limits

Roughly 1 GB published site, 100 GB/month bandwidth, ~10 builds/hour. A nightly run over a few thousand stars is orders of magnitude below all three. `dist/` at that size is a few MB of JSON plus one JS bundle.

## Failure behaviour

Any non-zero exit in `build` means no artifact is uploaded and `deploy` does not run — the previous night's site stays live. The pipeline itself aborts before writing output on a fetch failure, so a partial star list can never be published in place of a full one.
