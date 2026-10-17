---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done && [ \"$(grep -cE 'key name=\"(license-status|license-key|license-activation-id|license-valid-until|license-last-validated|last-online-at|trial-days-used|trial-last-used-date|trial-warning-last-threshold|trial-probe-result)\"' dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml)\" -eq 10 ] && grep -q '\"@haco-studio/gnome-licensing\"' package.json && grep -q '@haco-studio:registry=https://npm.pkg.github.com' .npmrc && grep -rq 'license.invalid' esbuild.config.js"
assignee: null
branch: task/1017-1728-license-gate
created_at: 2026-10-17T17:28:50Z
updated_at: 2026-10-17T17:47:01Z
---

# feat(licensing): add a license gate with a 30-day trial and license key activation

## Overview

Gate zatto behind a license, using the license gate client published as
`@haco-studio/gnome-licensing` (GitHub Packages, version
`0.1.0-next.0`, GPL-3.0-or-later). Its README (in the package, and at
https://github.com/haco-studio/capsa/tree/main/packages/gnome-licensing)
describes the behavior, the entry points, the parameters, the GSettings
keys and the wiring; follow it.

The behavior the package implements and zatto adopts as is: a trial of
30 days of use; a license key activated in the preferences; validation
against a license API; **no lock when the license API does not answer**
(timeout, DNS failure, 5xx, 404, 410, unknown 4xx), so zatto keeps working
if the API is down or retired; an offline limit of 7 days counted from
the last time the device was online; and a keyless probe after the trial
that unlocks when the API does not answer.

### Dependency and registry

- Add `@haco-studio/gnome-licensing` at `0.1.0-next.0` (exact) to
  `dependencies`, with the `@girs/*` peer dependencies already present.
- Add a project `.npmrc` that points the `@haco-studio` scope at
  `https://npm.pkg.github.com` and reads the token from
  `${NODE_AUTH_TOKEN}`.
- Every CI job that installs dependencies (the PR workflow, the release
  workflow, and any other) passes `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`
  to `npm ci` and has `packages: read` in its job permissions. No new
  secret.
- Make sure the release packaging test (`.github/scripts/package-extension.test.sh`)
  still builds.
- Document for contributors that installing dependencies needs a token
  with `read:packages` in `NODE_AUTH_TOKEN` (for example
  `NODE_AUTH_TOKEN=$(gh auth token)` after
  `gh auth refresh -s read:packages`), in the guide where the
  development setup is described.

### License API URL

There is no license API yet. Inject the base URL at build time, like a
build-mode constant: esbuild defines it from the `LICENSE_API_BASE_URL`
environment variable and falls back to `https://license.invalid`. The
`.invalid` top-level domain never resolves, so until a real URL is set
every request fails as no response and nothing is locked. The same value
reaches the preferences' license group.

### Wiring in the Shell process

- Declare the ten GSettings keys from the package README in the tracked
  schema (`dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml`),
  with the README's types and defaults.
- Create the repository, operations, `LicenseStateHandler` and
  `TrialWarningOperations` as the README shows, with the product name
  `Zatto`, and dispose of them in `disable()`. Implement
  `NotificationService` with the Shell's notifications.
- A day of use is a day the depth view is opened: call `recordUse()`
  when the user opens it (hot corner or the top bar menu), before
  checking whether zatto is locked.
- When zatto is locked, opening the depth view does not open it. Instead
  a notification explains why (`describeDisabledReason`) and points to
  the preferences, where a license can be activated. Unlocking (for
  example by activating a license in the preferences) takes effect
  without reloading the extension.
- The top bar indicator's menu shows the license status as a
  non-interactive row (`getLicenseStatusDisplay` with
  `purchaseAvailable: false`), above the existing items. Keep the menu
  built by the pure, unit-tested model.
- There is no purchase page: nothing offers to purchase a license.

### Preferences

Add the license group (`createLicenseGroup` from the `/prefs` entry,
no `purchaseUrl`) to the preferences window, on its own page or group
where it reads naturally.

### Documentation

Describe the trial, the license key and what happens when zatto is
locked in the user guide (`docs/guides/usage.md`), and mention licensing
in the README's Features if it fits.

Out of scope: a purchase page, the license API itself, and changing the
gate's behavior.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] The schema declares the ten license keys (gate in `check_command`).
- [x] `package.json` depends on `@haco-studio/gnome-licensing`, `.npmrc`
      points `@haco-studio` at GitHub Packages, and the build falls back
      to `https://license.invalid` (gates in `check_command`).
- [x] Unit tests cover opening the depth view: unlocked opens it and
      records a day of use; locked does not open it and shows the
      notification; the day of use is recorded before the lock check.
- [x] Unit tests cover the indicator menu model with a license status row
      for each status (trial with days left, trial expired, valid,
      expired, invalid), and no purchase item.

### Before merge (verified outside the check command)

- [ ] CI on the pull request installs `@haco-studio/gnome-licensing` from
      GitHub Packages with `GITHUB_TOKEN` and passes.
- [ ] After `npm run dev`, the journal shows no error from zatto, the
      top bar menu shows a trial status row, and `gsettings` (pointed at
      the extension's schema directory) reads the license keys with their
      defaults.
