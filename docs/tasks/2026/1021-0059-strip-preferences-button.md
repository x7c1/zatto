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
branch: task/1021-0059-strip-preferences-button
created_at: 2026-10-20T15:59:33Z
updated_at: 2026-10-20T16:13:07Z
---

# feat(strip): add a preferences button to the cycle strip's title row

## Overview

The preferences window can be opened from the top bar indicator's menu,
but `show-top-bar-indicator` can turn the indicator off, and then the
only way left is the Extensions app or `gnome-extensions prefs`. Give the
depth view itself a way in, as the author's other extension sutto does
with a settings button at the bottom of its panel.

Put a settings button at the right end of the cycle strip's title row
(the band under the thumbnails that holds the highlighted window's
title, `src/ui/overlay/cycle-strip.ts` and `cycle-strip-layout.ts`).
The strip is chosen over a fixed corner of the work area on purpose: the
strip follows the cursor, so the button is always near the pointer,
whereas a corner on a large display is far away and easily overlooked.

Reference implementation: sutto's `createFooter()` in
`src/ui/main-panel/renderer.ts` and `openPreferencesAndHide()` in
`src/ui/main-panel/index.ts` (https://github.com/x7c1/sutto,
GPL-3.0-or-later; read only).

- **Placement**: the button sits right-aligned in the title row, inside
  the strip's padding. The title stays centred on the strip as it is
  today, not on the space left of the button; keep it from running under
  the button (reserve the button's width on both sides of the title, or
  an equivalent that keeps it centred), and keep the ellipsizing.
- **Narrow strips**: a strip of one narrow thumbnail must still fit the
  button and a readable part of the title. Widen the strip to a minimum
  if needed; express any new size as a knob in `CYCLE_STRIP_TUNING`, and
  cover the geometry in `cycle-strip-layout.test.ts`.
- **Look**: the stock `preferences-system-symbolic` icon, small enough
  for the title row, with a subtle hover background and a pointer
  cursor, matching the strip's existing styling.
- **Action**: a press on the button closes the depth view without
  raising or changing anything (as Esc does) and opens the preferences
  window, the same `openPreferences()` the indicator menu uses. It must
  not reach the thumbnails or the large clones beneath, and must not
  count as a press on an empty spot or a window.
- **Hover**: moving the pointer onto the button must not make the strip
  disappear or be rebuilt; the button is part of the strip, so the
  existing rule that the pointer over the strip keeps it applies.
- No keyboard shortcut: zatto is driven by the mouse, so none is wanted.
- Document the button in `docs/guides/usage.md` (the thumbnail strip
  section, and wherever the guide says how to reach the preferences).

## Acceptance criteria

### Automated (pipeline-verified)

- [x] Unit tests cover the layout of the button and the title in the
      title row: the button is right-aligned within the padding, the
      title is centred on the strip and does not overlap the button, and
      a one-thumbnail strip is wide enough for both.
- [x] If the press handling is routed through a testable unit (the
      overlay controller or the state machine), a unit test shows that
      the button closes the overlay without activating a window and
      requests the preferences window.

### Before merge (verified outside the check command)

- [x] After `npm run dev`, with the indicator turned off, opening the
      depth view, moving over a window and pressing the button closes the
      depth view with the window order unchanged and opens the
      preferences window; GNOME Shell's journal shows no error from zatto.
