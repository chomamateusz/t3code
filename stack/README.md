# local/stack

This branch holds no upstream code. It holds our changes to [pingdotgg/t3code](https://github.com/pingdotgg/t3code) as a patch series, and the scripts the fork's GitHub Actions workflow uses to build T3 Code from upstream `main` plus that series.

The workflow runs from the fork's `main` (where the owner installs it) and takes everything else from this branch. The applied source is never pushed anywhere. Each release is tagged on a commit of this branch.

## Layout

- `patches/NNNN-*.patch`: the series, applied in name order with `git am`.
- `upstream-base`: the upstream commit the series was last carried onto.
- `series-date`: the date of the export (`YYYYMMDD`), part of every version.
- `tools/export-series.sh`: regenerates the three items above from a carried branch.
- `tools/verify-series.sh`: applies the series to a fresh upstream clone at `upstream-base` and requires the carried branch's tree.
- `ci/`: everything the workflow runs.
  - `fetch-upstream.sh`, `apply-series.sh`: fetch upstream and apply the series. A failed apply writes the failing patch and the conflicted paths to its result file.
  - `resolve-version.ts`: `<latest stable upstream, patch + 1>-local.stack.<series date>.<build number>`, build number = 1 + the highest existing fork tag with that prefix. It fails when the result would not be newer than every existing `v*-local.stack.*` tag, by the ordering the fleet installer uses.
  - `should-skip.ts`: skips the run when the newest stack release was built from the same upstream and stack commits.
  - `build-runtime.sh`, `container-build.sh`: build the Linux x64 runtime inside `ubuntu:22.04`.
  - `run-acceptance.sh`, `accept-fresh.sh`, `verify-*.mjs`, `fork-markers.json`: accept the runtime in fresh `ubuntu:22.04` and `ubuntu:24.04` containers, including checks that fork changes reached the bundle.
  - `classify-run.ts`: writes the run result (`stack-result` artifact and step summary).
- `workflow/stack-build.yml`: the source of `.github/workflows/stack-build.yml` on the fork's `main`.

## Export a series

After carrying the commits onto a new upstream base:

```sh
stack/tools/export-series.sh <carried-repo> <upstream-base-sha> <carried-branch>
stack/tools/verify-series.sh <carried-repo> <carried-branch> <scratch-parent-dir>
```

Commit `stack/patches`, `stack/upstream-base` and `stack/series-date` together. The series date is the UTC date of the export and never lower than the `series-date` already committed, so versions only move forward. If a carried change alters what the runtime contains, update `ci/fork-markers.json` in the same commit.

Tests: `bun test stack/ci`.

## Install the workflow

The workflow file lives on `main` because GitHub only runs scheduled workflows from the default branch. The agent never pushes workflow files; the owner installs or updates it:

```sh
git switch main
git fetch origin local/stack
git show origin/local/stack:stack/workflow/stack-build.yml > .github/workflows/stack-build.yml
git add .github/workflows/stack-build.yml
git commit -m "Install stack build workflow"
git push origin main
```

Each run warns when the installed file differs from `stack/workflow/stack-build.yml`.

## What a run produces

- A release `v<version>` on the fork, tagged on the `local/stack` commit it used, with `t3-<version>-linux-x64.tar.gz`, `SHA256SUMS` and `build-manifest.json` (`version`, `upstreamSha`, `stackSha`, `seriesDate`, `buildNumber`, `runUrl`). The release job runs nothing from this branch. Re-running it is safe: it removes leftover drafts for the tag, and when the tag is already published with the same manifest commits and `SHA256SUMS` it finishes without changes; any other existing tag fails the job.
- A build provenance attestation for each of the three release assets.
- A `stack-result` artifact (`stack-result.json`) with `status` (`success`, `skipped`, `failed`, `cancelled`), `stage` for a failed or cancelled run, and `workflowDrift` (`true` when the installed workflow differs from `workflow/stack-build.yml`; the run continues). The report job writes it even when its own tooling cannot be set up.

Stages:

| stage | meaning |
| --- | --- |
| `prepare` | failed before the series was applied, for a reason other than a patch conflict: checkout, tool download, upstream lookup, version resolution |
| `apply` | a patch did not apply to upstream `main`; `apply.failedPatch` and `apply.conflictedPaths` say where. The series needs carrying onto the new upstream |
| `test` | quality checks or tests failed on the applied source |
| `build` | building the Linux x64 runtime failed |
| `accept` | the runtime failed acceptance in a fresh `ubuntu:22.04` or `ubuntu:24.04` container |
| `release` | attesting or publishing the release failed |

Every stage other than `apply` needs investigation.

## Verify a release

```sh
gh release download v<version> -R chomamateusz/t3code -D t3-release
for asset in t3-release/*; do
  gh attestation verify "$asset" --repo chomamateusz/t3code \
    --signer-workflow chomamateusz/t3code/.github/workflows/stack-build.yml
done
```
