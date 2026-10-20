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
branch: task/1021-0325-frontmost-close-button
created_at: 2026-10-20T18:25:34Z
updated_at: 2026-10-20T19:10:52Z
---

# feat(overlay): add a close button to the frontmost window in the depth view

## Overview

The Activities Overview shows a close button at the top-right corner of
a window preview. Add the same to zatto's depth view, so a window can be
closed without leaving it.

- **Where**: on the clones of the depth view (`gnome-window-mirror.ts`),
  never on the cycle strip's thumbnails. One button at a time, at the
  top-right corner of the frontmost window's clone.
- **Which window is frontmost**: the focused window when the cycle has
  focused one (it is drawn on top of everything); otherwise the window
  drawn frontmost under the pointer, the one a click there would raise.
  Do not key it on the focus alone: a window that is in front without
  being cycled to, such as one that overlaps nothing, has no focus and
  would never get a button.
- **When it is hidden**: when nothing is focused and no window is under
  the pointer. With a focus, the button stays on the focused window even
  while the pointer is over empty desktop. There is no timeout: unlike
  the Overview, the button does not fade after a while; it stays until the
  frontmost window changes.
- **Pressing it**: asks the window to close, as the Overview does
  (`Meta.Window.delete()` with the current time), consumes the press so it
  neither activates the window nor counts as a press on empty space, and
  leaves the depth view open.
- **After the window goes**: drop its clone from the depth view (its
  transients with it). If a window was focused when it closed, move the
  focus to the next window, the one behind it in the same overlap if
  there is one; with nothing left to focus, clear the focus. If nothing
  was focused (the button was on the frontmost window under the pointer),
  leave the focus cleared: the button then moves by the pointer rule to
  the window now frontmost under the pointer. Focusing a window here
  would pin the button to it, and a window elsewhere that overlaps
  nothing could not get the button again until the depth view closes. The other clones stay where they are; do not
  re-run the layout. Closing the depth view afterwards must still restore
  the remaining real windows correctly, and the cycle strip must not keep
  a thumbnail of the closed window.
- **Confirmation dialogs**: a window that asks before closing (an unsaved
  document, for instance) opens a dialog instead of closing. Draw that
  dialog on the parent's clone in the depth view, as the Overview does and
  as zatto already does for transients present at open
  (`transient-attachment.ts`). Today the mirror only knows the windows
  that existed when the depth view opened, so it has to pick up a
  transient created while the view is up, and drop one that goes away.
  Keep the attachment rule shared with the mount.
- **Accessible names**: give the new close button and the cycle strip's
  preferences button (`cycle-strip.ts`) an `accessible_name` ("Close
  window" / "Preferences"); St has no stock tooltip, so no tooltip.
- **Look**: a round button with the stock `window-close-symbolic` icon,
  similar to the Overview's, sized and offset by knobs in
  `DEPTH_VIEW_TUNING`. It must stay inside the clone's visible area and
  follow the clone through its eases.
- Keep the decisions (which window is frontmost, which window to focus
  next, which windows to drop) in pure functions covered by vitest, next to
  `depth-cycle.ts` and `transient-attachment.ts`, and keep the GNOME side
  thin. Document the button in `docs/guides/usage.md` and, if the Inspect
  snapshot is the natural place, expose which window carries it.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] Unit tests cover choosing the window that carries the button: the
      focused window when there is a focus, the frontmost window under the
      pointer otherwise, and none when neither exists.
- [x] Unit tests cover the focus after a window closes: with a focus, the
      window behind it in the same overlap, and no focus when none is
      left; without a focus, the focus stays cleared.
- [x] Unit tests cover attaching a transient created while the depth view
      is open to its parent, with the same rule as at mount.

### Before merge (verified outside the check command)

- [x] `npm run dev` builds, installs and reloads the extension in the
      running GNOME Shell session, the Inspect endpoint answers
      `GetState`, and GNOME Shell's journal shows no error or warning from
      zatto after the reload.
