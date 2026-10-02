---
status: completed
pipeline_phase: null
plan: null
base_ref: task/1002-1647-hide-real-windows-and-animate-transition
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && grep -rq 'getWorkAreaForMonitor' src/libs/shell/ && grep -q 'primaryWorkArea' src/ui/overlay/overlay-actor.ts && grep -q 'primaryWorkArea' src/ui/overlay/gnome-window-mirror.ts && ! grep -q 'primaryMonitor' src/ui/overlay/gnome-window-mirror.ts && grep -rq 'class GnomeWindowMirror' src/ui/overlay/"
assignee: null
branch: task/1002-1720-fit-overlay-to-work-area
created_at: 2026-10-02T17:20:00Z
updated_at: 2026-10-02T17:40:00Z
---

# feat(overlay): confine the depth view to the work area so the top bar and the dock stay visible

## Overview

The overlay covers the whole primary monitor: the shade dims everything,
including the top bar and the dock, and the clone container uses the full
monitor as the area the depth layout fits into. The Activities Overview
behaves differently: the top bar stays where it is and keeps its look, the
dock stays visible at the bottom, and the windows are arranged in the space
between them, the monitor's work area (`Main.layoutManager.getWorkAreaForMonitor()`,
which subtracts the struts the panel and the dock reserve).

This task brings the overlay to the same geometry. The shade and the clone
container are positioned and sized to the primary monitor's work area, so
the top bar and the dock are not dimmed and nothing is drawn over them, and
the depth layout fits the clones into the work area. The clones still start
on the real windows when the overlay opens (a window can sit partly outside
the work area, e.g. under an auto-hidden dock) and ease into the work area
from there.

### Design

- **One source for the work area.** Add `primaryWorkArea()` in
  `src/libs/shell/work-area.ts` that returns
  `Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex)`
  as a plain `{ x, y, width, height }` in stage coordinates, or `null` when
  there is no primary monitor. `OverlayActor` and `GnomeWindowMirror` both
  read it from there; the mirror no longer reads `primaryMonitor` at all.
- **The grab actor keeps the whole monitor; the shade and the clones get the
  work area.** The dimmer is the modal grab actor and the corner re-entry
  sensor, and both rely on it covering the monitor, so its geometry and the
  `motion-event` corner check are unchanged. The shade and the clone
  container are placed at the work area's position relative to the monitor
  (`workArea.x - monitor.x`, `workArea.y - monitor.y`) with the work area's
  size. The dimmer itself has no background, so the top bar and the dock
  show through it exactly as the desktop does.
- **Mirror coordinates are relative to the work area.** `GnomeWindowMirror`
  converts frame and buffer rects by subtracting the work area's origin
  (rename `monitorOrigin` accordingly) and passes the work area's size to
  `computeDepthLayout()`. The clones still start at their buffer rects, so
  a window that extends outside the work area starts outside the container
  and eases in; the container does not clip. `closeTargetOf()` uses the
  same conversion.
- **Layout naming.** `computeDepthLayout()`'s second parameter and the
  `Size` it takes describe the area the clones must fit into, which is now
  the work area rather than the monitor; rename the parameter to `area`
  and update its doc comment and the module header where they say
  "monitor". The function's behaviour, inputs and outputs do not change,
  and the tests are updated only where they name the parameter.
- **Dock modes.** The work area excludes the dock only when the dock
  reserves space (Ubuntu's default, "auto-hide" off). With an auto-hiding
  dock the work area includes its strip, the overlay draws there, and
  whether the dock shows is the dock's own decision; say so in a code
  comment next to `primaryWorkArea()` and do not try to drive the dock.
- **README.** In the Status section, say the depth view is drawn in the
  work area, between the top bar and the dock. Keep the README short and
  do not link to planning documents outside the repository.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `src/libs/shell/work-area.ts` exports `primaryWorkArea()` built on
      `getWorkAreaForMonitor` (grep gate under `src/libs/shell/`), and both
      `overlay-actor.ts` and `gnome-window-mirror.ts` use it (grep gates on
      `primaryWorkArea` in each file); the mirror no longer references
      `primaryMonitor` (negative grep gate).
- [x] `computeDepthLayout()` keeps its behaviour: the depth-layout tests pass
      with only the parameter name changed.
- [x] `npm run build`, `npm run check:strict` and `npm run test:run` pass
      and `class GnomeWindowMirror` is still present.

### Manual / on-hardware (verified by a human before merge)

- [ ] On a real GNOME Shell session with `npm run dev` and the dock in its
      default always-visible mode, opening the overlay leaves the top bar
      and the dock undimmed and uncovered, and no clone is drawn over
      either of them once the open ease has landed.
- [ ] A maximized window's clone ends up inside the work area, scaled down
      as needed, and slides back onto the real window on close with no
      jump at landing.
- [ ] Corner re-entry, Esc and clone click still close the overlay, and the
      hot corner still opens it.
