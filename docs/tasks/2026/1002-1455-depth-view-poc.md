---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && ls src/ui/overlay/ | grep -qE 'depth.*\\.test\\.ts$' && grep -rqE 'translation_z|set_translation\\(' src/ui/overlay/ && grep -rqE 'set_scale\\(' src/ui/overlay/ && grep -rq 'class GnomeWindowMirror' src/ui/overlay/"
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
x, y. Instead, the stacking order becomes depth: the plane of windows is viewed
from a slight angle, like looking at a deck of cards from the side, and each
clone is pushed back by how many windows sit above it. The view is an
orthographic one, so windows keep a constant size regardless of depth and the
whole plane stays on the monitor. Clones are drawn translucent so a window that
is completely covered can still be made out. The purpose is to check whether
the tilt, the Z spacing and the translucency make the one or two windows
directly behind the active one recognisable without moving the cursor. Cycling the windows under the cursor, the open/close
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
  file. It takes the monitor-relative frame rects in stacking order, the
  monitor size and the tuning constants, and returns the per-clone horizontal
  offset and opacity plus one container transform. The topmost clone has
  offset 0 and every deeper clone is `zStepPx` further back, which the
  orthographic projection turns into an offset of `zStepPx·sin(tilt)` towards
  the near side. Opacity may be a constant for every clone or may fall off
  with depth; pick one, document why in the module header, and test it. Cover
  depth 0, a stack of several windows, the empty and single-window cases, and
  the fit (shift and, when needed, uniform scale-down) that keeps the
  projected plane inside the monitor.
- **Orthographic projection, applied to the container.** The stage projects
  with perspective, which enlarges the near edge of a rotated plane and pushes
  it off screen, so do not rotate actors in 3D. Project the tilted plane in
  the layout module instead: an orthographic view of a plane rotated by `t`
  squashes it horizontally by `cos t` and turns each clone's depth into a
  horizontal offset. `GnomeWindowMirror` keeps creating one reactive
  `Clutter.Clone` per window at the window's frame rect plus its offset, and
  applies the squash, the fit scale and the fit shift once to the clone
  container (`pivot_point` 0, 0, `set_scale`, `set_translation`).
  Transforming the container rather than each clone keeps every window's x, y
  relationship intact and makes the tilt a single number to tune.
- **Tuning constants in one place.** Define the initial values as one exported
  `DEPTH_VIEW_TUNING` object in `depth-layout.ts` (tilt angle in degrees, Z
  step in px, opacity). Start from a tilt of about 15 degrees, a Z step of
  about 80 px and an opacity of about 85 % for the topmost clone; these are
  the values the first on-hardware check will adjust, so the module header
  should say that they are starting points.
- **Reset on unmount.** `unmount()` must restore the container's scale and
  translation so the next mount starts from an untransformed container, and
  must keep tearing clones down synchronously as today. The container is owned by `OverlayActor`; reach
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
      asserts the topmost clone gets offset 0, each deeper clone is one
      `zStepPx·sin(tilt)` further towards the near side on screen, opacities
      stay within 0..255, the empty and single-window cases return sensible
      results, and the projected plane is shifted or scaled down to fit the
      monitor (`ls … | grep depth…test.ts` gate plus `npm run test:run`).
- [x] `GnomeWindowMirror` applies the per-clone offset and the container
      squash, fit scale and shift (grep gates on `set_translation(` and
      `set_scale(` under `src/ui/overlay/`), and the class is still present.
- [x] `npm run build`, `npm run check:strict` and `npm run test:run` pass, and
      the existing controller tests are unchanged in behaviour (the port
      surface did not move).

### Manual / on-hardware (verified by a human before merge)

- [ ] On a real GNOME Shell session with `npm run dev`, entering the hot corner
      shows every window at its own position, tilted as one plane that stays
      entirely on the monitor, with the windows further back visibly offset
      and translucent and no window larger or smaller than its neighbours
      because of depth.
- [ ] With two or three windows overlapping on the desktop, the edge of the
      window directly behind the active one can be told apart in the overlay
      without moving the cursor.
- [ ] Clicking a clone still raises that window and closes the overlay; Esc or
      re-entering the corner closes it; opening again after closing starts
      from a flat container (no accumulated tilt).
- [ ] Note the tilt, Z step and opacity values that looked right, so the next
      task can start from them.
