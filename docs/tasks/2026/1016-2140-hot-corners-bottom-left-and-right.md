---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && grep -rq \"'bottom-right'\" src/ui/overlay/ && [ \"$(grep -rl 'monitors-changed' src/ui/overlay/ | wc -l)\" -ge 2 ] && ! grep -rqi 'bottom-left hot corner' src/ui/overlay/"
assignee: null
branch: task/1016-2140-hot-corners-bottom-left-and-right
created_at: 2026-10-16T12:40:16Z
updated_at: 2026-10-16T13:27:26Z
---

# feat(overlay): open the depth view from both bottom corners and follow monitor changes

## Overview

The depth view opens only from the bottom-left corner of the primary
monitor. `HotCornerTrigger` (`src/ui/overlay/hot-corner-trigger.ts`)
installs a single invisible 5x5 px reactive actor at
`(monitor.x, monitor.y + monitor.height - 5)`. In daily use the author
also wants the bottom-right corner to open it.

This task lets the trigger serve a list of corners, and for now it is
built with both bottom corners. A second task will add a preferences page
that lets the user choose which corners are active, so the list must be
something the trigger receives from outside, not a constant buried in it.

The same `enable()` also fixes the corner position once, from the monitor
geometry at enable time, so after a monitor layout change the corner
drifts away from the actual corner (leftover from x7c1/zatto#17). Fix
this here, because once there are several corners, every one of them
would drift.

### Design

- **Corner as a value.** Introduce a corner type covering at least
  `'bottom-left'` and `'bottom-right'`, and a pure function that returns
  the trigger rect for a corner, a monitor rect and the side length. Put
  it in its own module under `src/ui/overlay/` with unit tests, so the
  geometry is tested without GNOME Shell. Keep the type open to
  `'top-left'` / `'top-right'` if that costs nothing, but do not install
  them.
- **One actor per corner, one handler.** `HotCornerTrigger` takes the
  corner list in its constructor and creates one actor per corner. Every
  actor calls the same registered handler. The Overview suppression, top
  chrome stacking, and teardown that apply to the single actor today
  apply to each actor. `HotCornerPort` does not change: the controller
  still sees one trigger with one `onEnter`.
- **Wiring.** `src/extension.ts` passes `['bottom-left', 'bottom-right']`.
  Keep this list in one named constant, so the preferences task can
  replace it with a setting.
- **Follow monitor changes.** Connect to `Main.layoutManager`'s
  `monitors-changed` while enabled, and move the actors to the new
  primary monitor's corners when it fires. Disconnect in `disable()`.
  If no primary monitor exists after the change, remove the actors and
  log a warning, the same way `enable()` handles that case today.
- **Docs.** Update the doc comments that say "bottom-left" (the file
  header of `hot-corner-trigger.ts`, `HOT_CORNER_SIZE`, the
  `HotCornerPort` comment in `ports.ts`) and the README's mention of the
  trigger corner, if there is one.

Out of scope: corners on secondary monitors (the overlay itself covers
only the primary monitor), and the preferences page and GSettings schema
(the next task).

## Acceptance criteria

### Automated (pipeline-verified)

- [x] A unit test asserts the trigger rect for `'bottom-left'` and
      `'bottom-right'` on a monitor with a non-zero origin (e.g. `x: 1920,
      y: 0`): bottom-left at `(x, y + height - size)` and bottom-right at
      `(x + width - size, y + height - size)`, both `size` x `size`.
- [x] `'bottom-right'` appears under `src/ui/overlay/` (gate in
      `check_command`).
- [x] The hot-corner trigger connects to `monitors-changed`, so at least
      two files under `src/ui/overlay/` mention it
      (`gnome-real-windows.ts` already does; gate in `check_command`).
- [x] No comment under `src/ui/overlay/` still calls the trigger the
      "bottom-left hot corner" (gate in `check_command`).

### Before merge (verified outside the check command)

- [x] After `npm run dev`, moving the cursor into the bottom-right corner
      of the primary monitor opens the depth view, and the bottom-left
      corner still does.
- [x] While the depth view is open, entering either corner closes it, as
      the bottom-left corner does today.
- [x] Dismissing via Esc or a click and then re-entering either corner
      opens the view again (no corner stays dead after a close beyond the
      existing debounce).
