---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && ls src/ui/overlay/ | grep -qE 'depth.*\\.test\\.ts$' && grep -rqE 'translation_z|set_translation\\(' src/ui/overlay/ && grep -rqE 'rotation_angle_[xy]|set_rotation_angle\\(' src/ui/overlay/ && grep -rq 'class GnomeWindowMirror' src/ui/overlay/"
assignee: null
branch: task/1002-1455-depth-view-poc
created_at: 2026-10-02T14:55:00Z
updated_at: 2026-10-02T15:57:31Z
---

# feat(overlay): render the stacking order as a tilted depth view (static proof of concept)

## Overview

The overlay currently mirrors every eligible window as a live clone at its own
on-screen position, full size and fully opaque. Windows that overlap on screen
therefore overlap in the overlay too, and a window one or two layers behind the
active one is as hidden in the overlay as it is on the desktop.

This task adds the first, static version of the depth view. Nothing moves in
x, y. Instead, the stacking order becomes depth: the clone container is tilted
a little, like looking at a deck of cards from an angle, and each clone is
pushed back along Z by how many windows sit above it. Clones are drawn
translucent so a window that is completely covered can still be made out. The
purpose is to check whether the tilt, the Z spacing and the translucency make
the one or two windows directly behind the active one recognisable without
moving the cursor. Cycling the windows under the cursor, the open/close
transition and hiding the real windows are separate, later tasks and are out of
scope here.

### Design

- **Depth from stacking order.** `global.get_window_actors()` returns window
  actors bottom-to-top. After the eligibility filter in
  `GnomeWindowMirror.collectEligible()`, the last entry is the topmost window
  and gets depth 0; each entry below it gets depth +1. Keep adding clones to the
  container in bottom-to-top order so the paint order stays correct: Clutter
  does not depth-sort children, so the topmost window must be added last.
- **Pure layout module.** Put the geometry in a new pure module
  `src/ui/overlay/depth-layout.ts` (no `gi://` imports) with a sibling vitest
  file. It takes the clone count and the tuning constants and returns, per
  stacking index, the Z translation and the opacity to apply. The topmost clone
  has Z translation 0 and every deeper clone is `zStepPx` further back
  (negative Z, away from the viewer). Opacity may be a constant for every
  clone or may fall off with depth; pick one, document why in the module
  header, and test it. Cover depth 0, a stack of several windows, and the empty
  and single-window cases.
- **Tilt the container, not each clone.** `GnomeWindowMirror` keeps creating
  one reactive `Clutter.Clone` per window at the window's frame rect. It
  applies the per-clone `translation_z` and `opacity` from the layout module,
  and tilts the clone container once by rotating it around the Y axis about
  its centre (`pivot_point` 0.5, 0.5 and `rotation_angle_y`), so the Z
  offsets become visible under the stage's perspective projection. Rotating
  the container rather than each clone keeps every window's x, y relationship
  intact and makes the tilt a single number to tune.
- **Tuning constants in one place.** Define the initial values as one exported
  `DEPTH_VIEW_TUNING` object in `depth-layout.ts` (tilt angle in degrees, Z
  step in px, opacity). Start from a tilt of about 15 degrees, a Z step of
  about 80 px and an opacity of about 85 % for the topmost clone; these are
  the values the first on-hardware check will adjust, so the module header
  should say that they are starting points.
- **Reset on unmount.** `unmount()` must restore the container's rotation to 0
  so the next mount starts from a flat container, and must keep tearing clones
  down synchronously as today. The container is owned by `OverlayActor`; reach
  it through the existing `getContainer` getter, do not add a second one.
- **Keep the seam intact.** `WindowMirrorPort`, `WindowMirrorSnapshot`,
  `FakeWindowMirror` and the controller do not change: the depth view is an
  implementation detail of the production mirror. If a tilt or translation
  call needs an actor API the current `@girs` typings do not expose, say so in
  the report rather than casting around it.
- **README.** In the Status section, replace the sentence that says a depth view
  is in progress with one that says the overlay now renders the stacking order
  as a tilted, translucent depth view and that cycling the windows under the
  cursor is the next step. Keep the README short and do not link to planning
  documents outside the repository.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `src/ui/overlay/depth-layout.ts` exists with a vitest sibling that
      asserts the topmost clone gets Z translation 0, each deeper clone is one
      `zStepPx` further back, opacities stay within 0..255, and the empty and
      single-window cases return sensible results (`ls … | grep depth…test.ts`
      gate plus `npm run test:run`).
- [x] `GnomeWindowMirror` applies a Z translation per clone and a Y-axis
      rotation on the clone container (grep gates on `translation_z` /
      `set_translation(` and `rotation_angle_y` / `set_rotation_angle(` under
      `src/ui/overlay/`), and the class is still present.
- [x] `npm run build`, `npm run check:strict` and `npm run test:run` pass, and
      the existing controller tests are unchanged in behaviour (the port
      surface did not move).

### Manual / on-hardware (verified by a human before merge)

- [ ] On a real GNOME Shell session with `npm run dev`, entering the hot corner
      shows every window at its own position, tilted as one plane, with the
      windows further back visibly offset and translucent.
- [ ] With two or three windows overlapping on the desktop, the edge of the
      window directly behind the active one can be told apart in the overlay
      without moving the cursor.
- [ ] Clicking a clone still raises that window and closes the overlay; Esc or
      re-entering the corner closes it; opening again after closing starts
      from a flat container (no accumulated tilt).
- [ ] Note the tilt, Z step and opacity values that looked right, so the next
      task can start from them.
