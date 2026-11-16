---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: null
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done && grep -q '\"@haco-studio/gnome-licensing\": \"0.1.0-next.1\"' package.json && grep -q 'gnome-licensing/0.1.0-next.1/' package-lock.json && ! grep -q 'gnome-licensing/0.1.0-next.0/' package-lock.json && grep -qE 'key name=\"trial-probed-at\" type=\"x\"' dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml && [ \"$(grep -cE 'key name=\"(license-status|license-key|license-activation-id|license-valid-until|license-last-validated|last-online-at|trial-days-used|trial-last-used-date|trial-warning-last-threshold|trial-probe-result|trial-probed-at)\"' dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml)\" -eq 11 ]"
assignee: null
branch: task/1116-1505-lock-only-while-license-server-answers
created_at: 2026-11-16T06:05:00Z
updated_at: 2026-11-16T06:12:18Z
---

# fix(licensing): lock and warn only while the license server answers

## Overview

zatto gates the depth view behind a trial of 30 days of use through
`@haco-studio/gnome-licensing` (pinned at `0.1.0-next.0` in `package.json`).
That version decides the lock after the trial from a single probe of the
license server made when the extension is enabled, locks a trial that ends
during a session even though the server was never asked, warns before the
trial ends whether or not the server answers, and refuses the very use that
counts day 30. The license server does not run yet (builds point at
`https://license.invalid` unless `LICENSE_API_BASE_URL` is set), so today
zatto can urge a user to buy a license that cannot be bought, and can lock
them out with no way to unlock.

`@haco-studio/gnome-licensing` `0.1.0-next.1` (published on GitHub Packages)
fixes this. Its README's "Behavior" section has the rules: the gate is a
reminder, so an ended trial is locked, and the pre-expiry warning is shown,
only when the most recent probe of the license server got an answer
(`answered`); with no response, or no probe yet (`none`), the extension
opens. Day 30 is usable and the trial ends with the first use on a 31st day.
Once the trial has ended or a warning threshold is reached, the server is
probed in the background on `initialize()`, on each `recordUse()` and when
the network comes back, at most once per 30 minutes. A valid license, a
rejected license (`expired` / `invalid`) and the 7-day offline grace period
are unchanged. The public API zatto uses (`LicenseStateHandler`,
`LicenseOperations`, `GSettingsLicenseRepository`, `HttpLicenseApiClient`,
`getLicenseStatusDisplay`, `createLicenseState`, `createLicenseGroup`) keeps
its signatures.

Make these changes:

1. **Upgrade the package.** Set `@haco-studio/gnome-licensing` to
   `0.1.0-next.1` in `package.json` and update `package-lock.json` with
   `npm install` (the registry is GitHub Packages, read through `.npmrc` with
   `NODE_AUTH_TOKEN`).
2. **Declare the added key.** `0.1.0-next.1` adds the GSettings key
   `trial-probed-at`: type `x`, default `0`, the time of the most recent
   probe of the license server in Unix seconds, `0` meaning none. Reading a
   key the schema does not declare aborts GNOME Shell, so add it to
   `dist/schemas/org.gnome.shell.extensions.zatto.gschema.xml` right after
   `trial-probe-result`, with a summary and a description written like the
   neighbouring license keys ("Managed by zatto."). Also update the
   description of `trial-probe-result`, which still says the check is made
   "after the trial ended"; it is now the result of the most recent probe,
   made once the trial has ended or a warning threshold has been reached.
   Guard: do not rename, retype or change the default of any existing key —
   installed copies hold values under them.
3. **Follow the new lock rule in the preferences.**
   `licenseNeedsAttention()` in `src/prefs/license-page.ts` decides whether
   the preferences open on the License page. For `trial-expired` it now
   returns true unless the probe result is `no-response`, i.e. also on
   `none`. Under the new rule an ended trial locks only on `answered`, so
   make it true only for `answered`, and update its doc comment and the
   tests in `src/prefs/license-page.test.ts` (`none` and `no-response` are
   false, `answered` is true).
4. **Update the user guide.** The "License" section of
   `docs/guides/usage.md` (the "Trial", "No answer, no lock" bullets and
   "When zatto is locked") describes the old rule: that the trial ends after
   30 days with a warning regardless of the server, and that the server is
   asked only "the next time it starts". Rewrite it to the new behaviour as
   seen by a user: day 30 is usable; the warnings at 3 and 1 days left and
   the lock after the trial come only while the license server answers;
   zatto asks the server in the background when the depth view is opened and
   when the network comes back, no more than every 30 minutes, and opening
   never waits for it. Keep the guide user-facing; the 30-minute interval
   and the background probe may be stated, but do not name GSettings keys.
   Check `README.md` and `docs/guides/installation.md` for statements that
   contradict the new rule and fix them too.

Out of scope: the license server itself, and notifying users when the server
starts selling licenses (the first lock after that comes without a warning
for a user who used up the trial before it started).

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `package.json` depends on `@haco-studio/gnome-licensing` `0.1.0-next.1`
      and `package-lock.json` resolves that version and no longer
      `0.1.0-next.0` (grep gates in `check_command`).
- [x] The schema declares `trial-probed-at` with type `x`, and declares each of
      the 11 license keys the package reads (count gate in `check_command`).
- [x] `licenseNeedsAttention()` is true for `trial-expired` only with probe
      result `answered`, and false with `none` and `no-response`; the other
      statuses keep their current answers (unit tests in
      `src/prefs/license-page.test.ts`).
- [x] The project builds, passes `biome check --error-on-warnings`, and the
      unit tests and the release script tests pass with the new version
      (`check_command`).

### Before merge (verified outside the check command)

- [ ] On a real GNOME Shell session (Ubuntu 26.04, Wayland), with a build
      that points at the default `https://license.invalid`, the extension
      enables after the upgrade without the Shell aborting, and an ended
      trial (set with `gsettings` to 30 days used, a past
      `trial-last-used-date`, then the depth view opened once) opens the depth
      view and shows neither a lock notification nor a trial warning; a
      trial at 26 days used with a past `trial-last-used-date`, opened once
      so that the 27th day is recorded and the 3-days-left threshold is
      reached, shows no warning either — needs a person: the
      cloud session has no GNOME Shell to run the extension in.
