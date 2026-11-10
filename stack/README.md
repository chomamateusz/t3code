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
  - `resolve-version.ts`: `<latest stable upstream, patch + 1>-local.stack.<series date>.<build number>`, build number = 1 + the highest existing fork tag with that prefix. With `--require-newer`, which the workflow passes only to a run that is going to build, it fails when the result would not be newer than every existing `v*-local.stack.*` tag, by the ordering the fleet installer uses.
  - `should-skip.ts`: skips the run when the newest stack release was built from the same upstream and stack commits.
  - `build-runtime.sh`, `container-build.sh`: build the Linux x64 runtime inside `ubuntu:22.04`.
  - `run-acceptance.sh`, `accept-fresh.sh`, `verify-*.mjs`, `fork-markers.json`: accept the runtime in fresh `ubuntu:22.04` and `ubuntu:24.04` containers, including checks that fork changes reached the bundle.
  - `verify-macos-release.ts`, `macos-signing.json`: check the signed macOS arm64 release files. `macos-signing.json` holds the bundle id, the SHA-1 of the signing certificate (the `certificate leaf` hash in the installed apps' designated requirement) and the update repository.
  - `classify-run.ts`: writes the run result (`stack-result` artifact and step summary).
  - `test-exclusions.json`, `test-exclusions.ts`: upstream tests the server and web test jobs skip because they fail only on the fork's runners, never because of our patches. Each entry carries the evidence (a run URL) that the test fails without our patches or for a reason outside our control. Remove an entry when its `removeWhen` condition holds, for example when upstream handles the case or the test passes on the runner again.
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

## macOS app

The macOS jobs run only when both repository Actions secrets are set: `STACK_MACOS_CERT_P12_BASE64` (the `.p12` export of the "T3 Code Local Signing" identity, base64) and `STACK_MACOS_CERT_PASSWORD`. The `macos_signing` job checks them; with neither set, the macOS jobs are skipped and the release carries only the Linux runtime; with one of them set, `macos_signing` fails. The skip check looks only at the upstream and stack commits, so after setting the secrets, dispatch the workflow with `force` to get the first macOS app without waiting for a new commit.

The certificate is self-signed: there is no Apple team, no notarization and no trust on the runner. A job that references a secret holds it on its runner for every step, so only two jobs reference the secrets, and neither runs code from the source, its dependencies or this branch: `macos_signing`, a single inline step without a checkout, and `build_macos_arm64_signed`, which runs only pinned checkout and artifact actions and inline steps. The macOS app takes four jobs:

1. `build_macos_arm64` builds the app unsigned with upstream's `scripts/build-desktop-artifact.ts` (update feed and allowlist set to this repository) and uploads the app and the electron-builder stage.
2. `build_macos_arm64_signed` reads the certificate's SHA-1 from `macos-signing.json`, signs the app with `codesign --force --deep` from a temporary keychain and uploads it. Archives keep the bundle's symlinks and modes.
3. `build_macos_arm64_packaged` repackages the signed app with `electron-builder --prepackaged`, which writes the zip, dmg, block maps and `latest-mac.yml` without signing again.
4. `build_macos_arm64_verified` runs on a fresh runner where no code from the source or its dependencies has run. It records the SHA-256 of the downloaded files' `SHA256SUMS` as its output before running anything else, then fails unless the zip holds one app directory and nothing else, the dmg holds that app, a link to `/Applications` and hidden files only, and the app in both passes `codesign --verify --deep --strict`, has the designated requirement `identifier "<bundleId>" and certificate leaf = H"<leafSha1>"`, carries the release version, an `app-update.yml` that points at this repository's releases and the same repository as `t3codeAllowedUpdateRepository` in `app.asar`, and `latest-mac.yml` matches the files.

The release job publishes the macOS files only when they match the `SHA256SUMS` whose hash the verification job recorded, so the packaging job, which runs upstream code, cannot swap files after the check. Installed apps accept an update only when its signature satisfies their designated requirement, so a new signing certificate needs a manual reinstall from the dmg on every Mac.

A release is one version for the fleet: with the secrets set, a failed macOS build means no release.

## Offering a release to installed apps

The workflow publishes every release as a prerelease. Installed apps ask GitHub for the release marked latest, which is never a prerelease, so they do not see a new build until it is promoted:

```sh
gh release edit v<version> -R chomamateusz/t3code --prerelease=false --latest
```

## What a run produces

- A prerelease `v<version>` on the fork, tagged on the `local/stack` commit it used, with `t3-<version>-linux-x64.tar.gz`, `SHA256SUMS` and `build-manifest.json` (`version`, `upstreamSha`, `stackSha`, `seriesDate`, `buildNumber`, `runUrl`). With the macOS app it also carries `T3-Code-<version>-arm64.zip`, `.zip.blockmap`, `.dmg` (and `.dmg.blockmap` when electron-builder writes one) and `latest-mac.yml`; `SHA256SUMS` lists every file except the manifest, and the manifest gains `macos.assets` (name and sha256 of each macOS file). The release job runs nothing from this branch. Re-running it is safe: it removes leftover drafts for the tag, and when the tag already points at the same stack commit and its release carries exactly the same assets, with the same manifest commits and `SHA256SUMS`, and the published files match those sums, it finishes without changes; any other existing tag fails the job and names what differed.
- A build provenance attestation for each release asset.
- A `stack-result` artifact (`stack-result.json`) with `status` (`success`, `skipped`, `failed`, `cancelled`), `stage` for a failed or cancelled run, `workflowDrift` (`true` when the installed workflow differs from `workflow/stack-build.yml`; the run continues) and `macosSigning` (whether the macOS app was due). The report job writes it even when its own tooling cannot be set up.

Stages:

| stage | meaning |
| --- | --- |
| `prepare` | failed before the series was applied, for a reason other than a patch conflict: checkout, tool download, upstream lookup, version resolution; or only one macOS signing secret is set |
| `apply` | a patch did not apply to upstream `main`; `apply.failedPatch` and `apply.conflictedPaths` say where. The series needs carrying onto the new upstream |
| `test` | quality checks or tests failed on the applied source |
| `build` | building the Linux x64 runtime failed, or building, signing or verifying the macOS arm64 app failed |
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
