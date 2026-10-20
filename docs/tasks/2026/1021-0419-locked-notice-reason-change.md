---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run"
assignee: null
branch: task/1021-0419-locked-notice-reason-change
created_at: 2026-10-20T19:19:51Z
updated_at: 2026-10-20T19:25:45Z
---

# fix(licensing): re-show the locked notice from a hot corner when the reason changes

## Overview

While zatto is locked, a refused open from a hot corner does not show the
locked notice again while the previous one is still in the message tray
(`LicenseOpenGate.allowOpen` in `src/licensing/license-open-gate.ts`,
which asks `LockedNoticePort.isLockedShown()`). That check ignores what
the notice says. If the reason for the lock changes while an old notice
is still in the tray, for instance the trial ended and later the license
needs to go online, a hot corner touch leaves the old reason in the tray,
and its "Open Preferences" offer may no longer fit.

Re-show the notice from a hot corner when the reason differs from the one
in the tray: compare the description (`DisabledReasonDescription`: the
headline, the instruction and whether preferences can be opened) of this
refusal with the one the shown notice carries. When they are the same,
keep today's behaviour and do not re-show. Requests from the indicator
keep showing it every time. Keep the comparison in `LicenseOpenGate` (or
another unit under vitest), keep `shell-notifications.ts` a thin adapter
that only reports what it shows, and update the "When zatto is locked"
section of `docs/guides/usage.md` if it states the rule.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] Unit tests show that, while a locked notice is in the tray, a refused
      open from a hot corner re-shows it when the description differs, and
      does not when it is the same.
- [x] The existing tests for the hot corner, the request and the dismissed
      notice still pass.
