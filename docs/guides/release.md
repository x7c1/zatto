# Release

How a zatto release is cut. A bot keeps one rolling release PR in sync with
`main`; cutting a release is writing its summary and merging it.

## Versions

A release is numbered by one integer: the `version` of `dist/metadata.json`,
which GNOME Shell and extensions.gnome.org read. There is no semver and no
`version-name`.

| What | Form | Example |
|---|---|---|
| `dist/metadata.json` `version` | `<N>` | `3` |
| Tag | `v<N>` | `v3` |
| Release PR title | `Release v<N>` | `Release v3` |
| Release asset | `zatto@x7c1.github.io.v<N>.shell-extension.zip` | `zatto@x7c1.github.io.v3.shell-extension.zip` |

`version` `0` on `main` means nothing has been released yet; the first
release is v1. Each release is the previous one plus one. You never edit
`version` by hand: the release PR carries the bump.

## Normal flow

1. On every push to `main`, the `Create Release PR` workflow opens or
   refreshes one open PR labelled `release` and titled `Release v<N>`, where
   `<N>` is `main`'s version plus one. Its branch (`release/v<N>`) is the
   latest `main` plus one commit, `Release v<N>`, that bumps
   `dist/metadata.json` to `<N>`. The bot rebuilds and force-pushes that
   branch every time, so do not push to it.
2. The PR body has a summary region you write by hand and, below it, the
   changelog since the last tag, generated from the conventional-commit
   subjects (`feat:`, `fix(scope):`, ...). See [Release summary](#release-summary).
3. Write the summary. The `Validate Release PR` check fails until you do.
4. Squash-merge the PR when you want to release. The squashed commit message
   starts with `Release v<N>`, which tells `Create Release PR` not to open a
   new PR for the release that just landed.
5. When CI passes on that commit, the `Release` workflow sees the version
   change, builds the extension with `npm run build:release`, packages
   `dist/` as the zip above, and publishes a GitHub Release tagged `v<N>`
   with the zip attached. Its body is your summary followed by links to the
   release PR (which keeps the full changelog) and the compare view.
6. The next push to `main` opens the release PR for `v<N+1>`.

While a merged release has no tag yet (between steps 4 and 5, or when the
`Release` run failed), `Create Release PR` does nothing: the next number
would collide with the pending one. It resumes once the tag exists.

## Release summary

The release PR body is split by a marker line:

```markdown
## Summary

<!-- release-summary:todo -->
_Write the release summary here. It becomes the body of the GitHub Release.
Delete the marker comment above once written._

<!-- changelog:auto -->

## Features

- feat(overlay): ...
```

- Everything **above** `<!-- changelog:auto -->` is yours. The bot copies it
  verbatim every time it regenerates the body.
- Everything from the marker down is regenerated on every push to `main`;
  edits there are overwritten.
- Keep the marker line. A body without it has no summary as far as the bot
  and the check are concerned, and the next regeneration replaces the whole
  body, starting again from the placeholder.

Edit the PR description, replace the placeholder with a few lines on what
changed for users, and delete the `<!-- release-summary:todo -->` comment.
Saving the description re-runs `Validate Release PR`, so the check turns
green without a push.

## Checks on the release PR

`Validate Release PR` (job `validate-title`) runs on every PR and passes at
once when the title does not start with `Release v`, so it can be a required
check. On a release PR it fails when:

- the title is not exactly `Release v<N>` (a semver title such as
  `Release v1.0.0` fails);
- `<N>` differs from the branch's `dist/metadata.json` version;
- `<N>` is not the last tag's number plus one (or `1` with no tag);
- the summary is empty or still carries `<!-- release-summary:todo -->` or
  the placeholder sentence.

The check blocks the merge only once `validate-title` is a required check in
`main`'s branch protection; add it there after the workflow has run once.
Until then a release PR without a summary can be merged, and the `Release`
run then fails for want of one (see [When something fails](#when-something-fails)).

`CI` runs on the release PR like on any other PR.

## RELEASE_PAT

`Create Release PR` pushes the release branch and opens the PR with the
repository secret `RELEASE_PAT`, not the workflow's `GITHUB_TOKEN`. GitHub
does not run `pull_request` workflows on PRs authored by
`github-actions[bot]`, so a PR opened with `GITHUB_TOKEN` would never get
`CI` or `Validate Release PR`, and could not be merged under branch
protection. With the PAT, the PR is authored by the token's user and the
checks run normally. The job's own token is read-only.

To set it up (once, and again when the token expires):

1. Create a fine-grained personal access token with access to this
   repository only, and the repository permissions **Contents: Read and
   write** (push the release branch) and **Pull requests: Read and write**
   (open and edit the release PR).
2. Save it as the repository's Actions secret `RELEASE_PAT`.

Without the secret, `Create Release PR` fails at its first step. There is no
fallback to `GITHUB_TOKEN`: it would open a PR whose checks never run.

The `Release` workflow uses `GITHUB_TOKEN`: it creates the Release and
edits the merged PR, which needs no other workflow to react.

## Workflows and scripts

- `.github/workflows/create-release-pr.yml` — opens or refreshes the release
  PR on every push to `main`, except the release merge itself.
- `.github/workflows/validate-release-pr.yml` — the `validate-title` check.
- `.github/workflows/release.yml` — after `CI` succeeds on `main`, releases
  when the head commit raised the version. Its `build` job (read-only)
  checks out the commit CI tested, reads the summary from the merged release
  PR, builds and packages; `publish` (the only job that can write a Release,
  and it runs only `gh`) creates a draft, attaches the zip, checks it is
  there and publishes, which creates the tag; `rewrite-links` points the
  release PR's compare link, which named the release branch, at the tag.
- `.github/scripts/` — the logic behind them. Version arithmetic and title
  validation are in `release-version.sh`; the body layout, summary handling
  and link rewrite in `release-summary.sh`. Both are pure functions covered by
  `release-version.test.sh` and `release-summary.test.sh`;
  `package-extension.test.sh` builds a release in a temporary copy of the
  working tree and checks the zip carries `prefs.js` and the schema XML but
  not the compiled schema.
  `CI` runs every `*.test.sh` there. Run them locally with
  `for t in .github/scripts/*.test.sh; do bash "$t"; done`.

## When something fails

- **`Create Release PR` failed.** Read the run's log. A missing or expired
  `RELEASE_PAT` fails the first step or the push: renew the secret, then
  re-run the job. The script is idempotent: it rebuilds the branch from
  `main` on every run.
- **The release PR is stale or broken.** Close it and delete its branch; the
  next push to `main` (or a re-run of the last `Create Release PR` run)
  opens a fresh one.
- **`Validate Release PR` failed.** The log names the rule. An unwritten
  summary is fixed by editing the description. A wrong title or version
  means the title or the branch was changed by hand: re-run the last
  `Create Release PR` run (or push to `main`) to retitle and rebuild it.
- **`Release` did not run.** It runs only after a green `CI` on `main`. Fix
  `CI`, then re-run the failed `CI` run on the release commit; the `Release`
  run that follows releases it.
- **`Release` failed.** Nothing but that run will cut the release: the
  version check compares each commit with its parent, so runs for later
  commits see no change. Fix the cause and use "Re-run all jobs" on the
  failed run, which checks out the same commit:
  - No summary: edit the merged PR's description (still editable after
    merge) and re-run.
  - A build or upload failure leaves at most a draft Release and no tag;
    the re-run updates that draft and replaces its asset.
  - `rewrite-links` failed after publishing: the Release is out; re-run
    only that job.
