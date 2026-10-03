# CI and Deployment

Two workflows. `.github/workflows/ci.yml` (name **"CI"**) validates and deploys nothing; `.github/workflows/nightly.yml` (name **"Starmap sync + deploy"**) runs the pipeline and publishes. Both live in the repository root, which is where GitHub looks for project pages either way.

## `ci.yml` — validation only

```yaml
on:
  pull_request:
  push:
    branches: [main, qoder/**, fix/**, claude/**]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

Two jobs, no secrets, and deliberately nothing that can publish.

**`checks`** — `npm ci`, then `npm run lint`, `npm run typecheck`, `npm test`.

**`browser`** — `npm run fixture` (writes `public/data/`), `npm run build`, `npm run smoke`. The fixture exists because `data/` is gitignored: a PR checkout has no dataset, and generating one *through the real pipeline* (graph build, sharding, MiniSearch serialization) means the browser is testing published-shaped JSON rather than a hand-written approximation of it.

The reason `browser` exists at all: every layout, canvas-painting, and keyboard regression found so far passed type-checking and the unit suite. Those bugs live in what gets *drawn*, which only a renderer can attest to. It is raw CDP over Node's global WebSocket rather than Playwright or Puppeteer so the job costs one binary the runner already has and no pinned Chrome download — see [Local Development](Local-Development.md).

Finding that binary is the harness's problem, not the workflow's. `tests/browser/lib.mjs` tries `google-chrome-stable`, `google-chrome`, `chromium`, `chromium-browser` in that order and **keeps the first that actually exposes a working DevTools endpoint** — resolution is by launching, not by `--version`, because a browser can print a version and still refuse to bind. Each attempt gets a private `--user-data-dir`, asks for `--remote-debugging-port=0`, and reads the port the browser chose out of the `DevToolsActivePort` file it writes there once the listener is up. `CHROME_PATH` skips the list entirely, and a failed attempt prints why. That is why the job needs no install step. `SMOKE_BASE` overrides the URL the harness drives, and `npm run smoke` starts its own `vite preview` when nothing is already answering it.

Every one of those rules was learned the hard way, in the first three CI runs of this suite:

- The preview server was spawned without a `--host`, so Vite bound the OS's idea of `localhost` — `::1` on a clean machine — while the harness probed `127.0.0.1`. CI failed, local passed, and the local pass was itself a lie: a stray `npm run preview` was already on the port, so the spawn path never ran. The host now comes from `SMOKE_BASE` and `--strictPort` keeps a real clash loud.
- A run then failed with `chromium did not expose a debugging port` in one job while the identical commit passed in the other, on the same image version. The harness had been betting the whole run on the first name whose `--version` answered; it walks the list now instead.
- The next run had all four candidates fail in one job and pass in the other, with the same runner image version again. What the four new diagnostics had in common was the port: a fixed 9222 is a shared resource that can already be taken, and nothing else about the run was fixed-port dependent. Port 0 removes that failure mode by construction. The flake itself is still not reproduced or explained — see [Known Gaps](Known-Gaps.md) — but the timing that had replaced the old 6-second budget is now bounded by the browser's own readiness signal instead of a guess about machine speed.

`pull_request` is unfiltered, so a PR from any branch gets a verdict here. The `push` branch list covers the long-lived branch prefixes this repo actually uses (`qoder/**`, `fix/**`, `claude/**`), because those branches are pushed to without a PR open in between and a red run should be visible then, not only at merge time. `cancel-in-progress: true` is safe because nothing in this workflow has side effects worth finishing.

## `nightly.yml` — sync and deploy

### Triggers

```yaml
on:
  push:
    branches: [main]
  schedule:
    - cron: "0 18 * * *"      # 18:00 UTC nightly
  workflow_dispatch:
    inputs:
      full_pass:
        type: boolean
        default: false
        description: "Force a full pass (re-walk every page, prune unstars now)"
```

Note the push trigger is hardcoded to `main`. Work on a feature branch syncs nothing and deploys nothing until it merges — which is what you want, but it means a branch-based first run must be started with **Run workflow**.

`full_pass` sets `FORCE_FULL=1` on the sync step. Before it existed, the only ways to force a full pass were editing the YAML or waiting for Sunday (UTC), which is a poor interface from a phone. Leaving the checkbox off renders the expression as an empty string, and `sync.ts:47` tests `process.env.FORCE_FULL === "1"` — so "off" means "not forced" rather than "set to something falsy that a future change might misread".

Cron must stay static here; `config.yml`'s `schedule` is documentation only. See [Configuration](Configuration.md).

### Permissions

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

#### Jobs

#### `build`

1. `actions/checkout@v4`
2. `actions/setup-node@v4` — Node 22, `cache: "npm"`
3. `npm ci`
4. `npm run lint`, `npm run typecheck`, `npm test`
5. `npm run sync` with `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}`, and `FORCE_FULL` from the `full_pass` input
6. `npm run build`
7. Commit and push the caches (below)
8. `actions/upload-pages-artifact@v3` with `path: dist`

Step 4 is the gate. `npm run build` alone only runs `tsc -p tsconfig.json --noEmit`, which checks `src` — so a `pipeline/**` type error, a broken classification-cache rule, or a failed regression test used to deploy anyway. Lint, type-check, and the unit tests now run *before* the sync step, so a red suite cannot publish. This workflow does not run `npm run smoke`: it would need a fixture dataset built first, and the sync step is about to overwrite `public/data/` with the real one. The PR-side `browser` job covers that path, and if it is green on the PR, the merged code it tested is what ships. If a nightly ever needs the browser verdict against real data, run the sync locally.

The `sync` step happens **before** `build`, which is what puts `public/data/` on disk so Vite copies it into `dist/`. Swap those two and you publish an empty dataset with no error.

#### The commit step

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
- Commits authored by `GITHUB_TOKEN` do not trigger other workflows, so this push does not re-enter the `on: push` trigger. No loop. If you split deploy into a second workflow triggered by `push`, that deploy job will silently never fire — this is why sync, build, and deploy are one workflow. `ci.yml` is also immune: its `pull_request` trigger can never be started by a bot commit, and its `push` branches are there for a human pushing directly to `main`.

#### `deploy`

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
| Token commits don't chain workflows | Sync, build, and deploy are one workflow; the second workflow validates on PRs, where a bot commit can't start it. |
| Artifact, not a branch | `data/` never enters git history. |

A relative-path slip is the classic fork-breaking bug: it works on `owner/starmap` and 404s on any other repo name. `npm run preview` locally is a decent proxy for catching it; the dev server is not, because it serves from `/`.

## Soft limits

Roughly 1 GB published site, 100 GB/month bandwidth, ~10 builds/hour. A nightly run over a few thousand stars is orders of magnitude below all three. `dist/` at that size is a few MB of JSON plus one JS bundle.

## Failure behaviour

Any non-zero exit in `build` means no artifact is uploaded and `deploy` does not run — the previous night's site stays live. The pipeline itself aborts before writing output on a fetch failure, so a partial star list can never be published in place of a full one.
