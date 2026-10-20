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
branch: task/1021-0316-locked-notice-once
created_at: 2026-10-20T18:16:17Z
updated_at: 2026-10-20T18:24:22Z
---

# fix(licensing): stop re-showing the locked notice on every hot corner touch

## Overview

While zatto is locked, every touch of a hot corner refuses the open and
shows the locked notice again (`src/licensing/license-open-gate.ts`,
`src/licensing/shell-notifications.ts`). The newer notice replaces the
previous one, so the tray does not fill up, but a banner pops up on every
touch, about every 250 ms debounce when the pointer brushes the corner
repeatedly. Hot corners are touched by accident, so this is noise.

Change when the notice is shown:

- **From a hot corner**: while the previous locked notice is still in the
  message tray (not yet dismissed or destroyed), do not show it again. Once
  the user dismisses it, or it otherwise leaves the tray, the next refused
  open from a hot corner shows it again.
- **From an explicit request** (the top bar indicator's "Open Depth View",
  or any other entry point that is not a hot corner): show it every time,
  replacing the previous one as today, because the user asked for the
  depth view and must see why it did not open.

The open path has to carry where the request came from as far as the
gate. Keep the decision of whether to re-show in a unit that runs under
vitest with the existing fakes (`src/licensing/test-fakes.ts`), and keep
`shell-notifications.ts` a thin adapter. Recording the use and the lock
decision itself do not change. Update `docs/guides/usage.md` (or
whichever guide describes the locked notice) if it describes when the
notice appears.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] Unit tests show that, while locked, a second refused open from a hot
      corner does not show the notice again while the first is still in
      the tray, and does show it again after the first has gone.
- [x] Unit tests show that a refused open from the indicator's
      "Open Depth View" shows the notice every time, even while a previous
      one is still in the tray.
- [x] Existing gate tests (recording a use before checking the lock, a
      failure to record not locking zatto) still pass.
