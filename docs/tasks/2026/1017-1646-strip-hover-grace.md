---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done"
assignee: null
branch: task/1017-1646-strip-hover-grace
created_at: 2026-10-17T16:45:00Z
updated_at: 2026-10-17T17:16:00Z
---

# fix(overlay): keep the strip for a moment while the pointer travels to it

## Overview

While the depth view is open, the strip of thumbnails at the bottom of
the screen shows the windows under the pointer
(`GnomeWindowMirror.hoverAt()` in `src/ui/overlay/gnome-window-mirror.ts`).
Any window under the pointer, alone or in an overlap, replaces what the
strip shows, and empty desktop takes the strip down. When the user moves
the pointer from an overlap down to the strip to pick a thumbnail, the
path often crosses another window or a gap, and the strip is rebuilt for
that window, or hidden, before the pointer arrives.

Add a short grace period: while the strip is shown, a pointer that moves
onto a different group, or onto empty desktop, does not change the
strip at once. The change takes effect only if the pointer is still over
that group (or still over empty desktop) when the grace period ends.
Reaching the strip within the grace period cancels the pending change.
Showing the strip when none is shown stays immediate. A click, Enter or
a scroll acts on what is under the pointer at that moment as before; the
grace period delays only what the strip displays.

Put the decision in a pure, unit-tested unit with an injectable clock
or timer (as the codebase does elsewhere, see `src/ui/overlay/ports.ts`
and `test-fakes.ts`), and make the duration a knob in
`DEPTH_VIEW_TUNING`, starting around 150 ms. Cancel any pending timer
when the overlay closes or unmounts.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] Unit tests cover: the first group shows the strip immediately; a
      different group within the grace period does not replace the strip;
      a different group still under the pointer when the grace period ends
      replaces it; empty desktop hides the strip only after the grace
      period; reaching the strip within the grace period keeps the current
      strip; closing the overlay cancels a pending change.
- [x] The grace period is a `DEPTH_VIEW_TUNING` knob.
