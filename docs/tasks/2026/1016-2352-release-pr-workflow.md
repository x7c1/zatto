---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done && [ \"$(ls .github/scripts/*.test.sh | wc -l)\" -ge 2 ] && [ \"$(jq -r .version dist/metadata.json)\" = 0 ] && grep -q 'secrets.RELEASE_PAT' .github/workflows/create-release-pr.yml && grep -q 'validate-title:' .github/workflows/validate-release-pr.yml && grep -q 'shell-extension.zip' .github/workflows/release.yml && grep -q 'test.sh' .github/workflows/pr.yml && test -f docs/guides/release.md"
assignee: null
branch: task/1016-2352-release-pr-workflow
created_at: 2026-10-16T14:52:24Z
updated_at: 2026-10-16T15:18:56Z
---

# ci(release): open a rolling release PR on every push to main and publish the extension when it merges

## Overview

zatto has no release process yet: the only workflow is CI
(`.github/workflows/pr.yml`, job `check`), there are no tags, and
`dist/metadata.json` carries `"version": 1` that nothing reads. This task
adds a release process modelled on two sibling GNOME/desktop projects by
the same author, both public on GitHub:

- **x7c1/sutto** (a GNOME Shell extension, like zatto) — numbering and
  packaging: `.github/workflows/create-release-pr.yml`,
  `.github/workflows/release.yml`, `.github/scripts/create-release-pr.sh`,
  `generate-changelog.sh`, `update-release-pr-links.sh`,
  `scripts/check-version-change.sh`, `scripts/package-extension.sh`,
  `docs/guides/08-release-workflow.md`.
- **x7c1/delta** — the PR body with a hand-written summary and the gate on
  it, and the PAT-based PR creation:
  `.github/workflows/create-release-pr.yml`,
  `.github/workflows/validate-release-pr.yml`,
  `.github/scripts/release-summary.sh`, `release-summary.test.sh`,
  `validate-release-summary.sh`, `release-pr-lookup.sh`,
  `update-release-pr-links.sh`, `docs/guides/release.md`.

Read both repositories' sources.
Port the mechanisms, not the project-specific parts (sutto's license
secrets, delta's Cargo version bump, desktop bundles, signing, and its
semver title promotion).

### Design

- **Versioning: one integer.** The version is `dist/metadata.json`'s
  integer `version`, as GNOME Shell and extensions.gnome.org require. Tags
  are `v<version>`, the release PR title is `Release v<version>`, and the
  asset is `zatto@x7c1.github.io.v<version>.shell-extension.zip`. No
  `version-name`, no semver. The next version is the current
  `metadata.json` version plus one, as in sutto.
- **First release is v1.** Set `dist/metadata.json`'s `version` to `0` in
  this task, meaning "not released yet", so the first release PR bumps it
  to `1` and the version-change detection fires on its merge.
- **Release PR (`Create Release PR`).** On every push to `main` except the
  release merge itself (head commit message starting with `Release v`),
  create or update one open PR labelled `release`, titled
  `Release v<next>`, whose branch bumps `metadata.json` to `<next>` on top
  of the latest `main`. Push the branch and call `gh` with the
  `RELEASE_PAT` repository secret (already registered), not
  `GITHUB_TOKEN`: PRs authored by `github-actions[bot]` do not trigger
  `pull_request` workflows, so CI and the release check would never run
  on the release PR. The job's own token stays read-only. With no
  `RELEASE_PAT`, fail loudly; do not fall back to `GITHUB_TOKEN`.
  Delta's `pull_request: [edited]` trigger exists only for title
  promotion and is not needed.
- **PR body.** As in delta: a hand-written summary region at the top,
  carried over verbatim on every regeneration, then the
  `<!-- changelog:auto -->` marker and the conventional-commit changelog
  since the last tag (sutto's / delta's `generate-changelog.sh`) plus the
  compare link. A fresh release PR starts with the summary placeholder and
  its todo marker.
- **Release check (`Validate Release PR`, job `validate-title`).** Runs on
  every PR (`opened`, `edited`, `synchronize`, `reopened`) and passes
  immediately for a PR whose title does not start with `Release v`, so it
  can be a required check. For a release PR it fails when the title is not
  `Release v<N>` with `<N>` equal to the branch's `metadata.json` version
  and to the last tag's number plus one (or `1` with no tag), and when the
  summary is empty or still carries the todo marker. The job name must be
  `validate-title`, the name the branch protection will require.
- **Release (`Release`).** After CI succeeds on `main`, when
  `metadata.json`'s version changed in the head commit: build with
  `npm run build:release`, zip `dist/` into the asset name above, and
  publish a GitHub Release tagged `v<version>` whose body is the merged
  release PR's summary followed by links to the release PR and the compare
  view (delta's `release-summary.sh` / `release-pr-lookup.sh`). Then
  rewrite the merged release PR's temporary branch compare link to the tag
  (`update-release-pr-links.sh`).
- **Testable without GitHub.** Keep the logic in `.github/scripts/` as
  small functions that can run without the network: next-version
  computation, title validation, summary extraction and validation, body
  regeneration that preserves the summary. Cover them with plain bash test
  scripts named `*.test.sh` (delta's `release-summary.test.sh` is the
  model), at least two of them, and run every `*.test.sh` in CI by adding
  a step to `.github/workflows/pr.yml`.
- **Pin actions.** Use actions pinned by commit SHA with a version
  comment, as delta does.
- **Docs.** Add `docs/guides/release.md` describing the flow from the
  maintainer's side: what the bot does, writing the summary, merging to
  release, the `RELEASE_PAT` setup (fine-grained token on this repository
  with Contents and Pull requests read/write) and why it is needed, and
  what to do when a release run fails. Link it from `README.md` if the
  README has a place for development docs.

Out of scope: publishing to extensions.gnome.org, and adding
`validate-title` to the branch protection (done by hand once the workflow
has run).

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `dist/metadata.json` has `"version": 0` (gate in `check_command`).
- [x] At least two `.github/scripts/*.test.sh` scripts exist and pass,
      covering: the next version from the current `metadata.json` version;
      title validation accepting `Release v<last tag + 1>` and rejecting a
      wrong number, a semver title and a non-matching `metadata.json`;
      summary validation rejecting an empty summary and the todo marker;
      and body regeneration preserving a hand-written summary while
      replacing the changelog below the marker.
- [x] `create-release-pr.yml` uses `secrets.RELEASE_PAT` for the push and
      for `gh`, `validate-release-pr.yml` has a job named `validate-title`,
      and `release.yml` attaches a `*.shell-extension.zip` asset (gates in
      `check_command`).
- [x] CI (`pr.yml`) runs every `*.test.sh` (gate in `check_command`).
- [x] `docs/guides/release.md` exists (gate in `check_command`).
