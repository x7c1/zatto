---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: null
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && ! grep -rqiE 'zone|quadrant|wm_class|packIntoZone' src/ README.md package.json && grep -rq 'class OverlayStateMachine' src/ui/overlay/ && grep -rq 'class HotCornerTrigger' src/ui/overlay/ && grep -rq 'class GnomeWindowMirror' src/ui/overlay/ && grep -rq 'class DBusInspector' src/libs/ && grep -rq 'class DBusReloader' src/libs/"
assignee: null
branch: task/1002-1432-remove-zone-layout
created_at: 2026-10-02T14:32:36Z
updated_at: 2026-10-02T14:50:17Z
---

# refactor(overlay): drop per-app zone routing and packed layout, keep the overlay scaffold

## Overview

zatto is changing direction. The first proof of concept routed every window
into one of four fixed screen zones by `wm_class` and packed same-zone windows
into a justified grid, so that each app category always landed in the same
place. Daily use showed that what the author actually needs is lighter: the
target window's position is already known, it is just one or two layers behind
the active one, and the job is to lift it to the front without re-arranging
anything. The next UI will keep every window at its on-screen x, y, render the
stacking order as depth (a tilted view with Z offsets and translucency), and
cycle the windows under the cursor with the scroll wheel.

Before that UI is built, remove the zone machinery so the next step starts from
a clean base. Everything that is not about zones stays: the build and bundling
setup, the D-Bus reloader and Inspect endpoint, the hot-corner trigger, the
overlay actor and modal grab, the overlay state machine and its controller, and
the port / fake test seam.

### Delete

- `src/ui/overlay/zone-config.ts`, `src/ui/overlay/zone-layout.ts`,
  `src/ui/overlay/app-zone-map.ts` and their `*.test.ts` siblings. Nothing
  outside `src/ui/overlay/` imports them except `src/extension.ts`, which passes
  `DEFAULT_ZONE_CONFIG` into the mirror.
- The routing, packing and easing paths in
  `src/ui/overlay/gnome-window-mirror.ts` (`groupByZone`, `layoutZone`,
  `packIntoZone` / `rectToPixels` calls, `resolveEasingMode`,
  `isAnimationEnabled`, the animated `unmount` branch and `transitionPending`
  bookkeeping). The mount/unmount ease existed only to fly clones between the
  real window rect and a packed slot; with no packed slot there is nothing to
  ease. The transition animation for the depth view will be designed and added
  with that view, not kept from this layout.

### Keep and reduce

- `GnomeWindowMirror` still enumerates eligible windows (`NORMAL`, not
  minimized, with a `Meta.Window`), creates one reactive `Clutter.Clone` per
  window at the source window's frame rect relative to the primary monitor,
  activates the window on click and calls `onActivated`. Its constructor loses
  the config parameter; the actor and current-time sources stay injectable.
- `WindowMirrorPort.unmount()` loses its `options` parameter: with the animated
  path gone there is no longer an `immediate` variant to select. Update the
  controller's `disable()` comment, which currently explains why it forces the
  synchronous path, and the fakes.
- `WindowMirrorSnapshot` shrinks to `clonedCount` and `lastActivatedAt`. Drop
  `byZone`, `zoneConfig` and the `WindowMirrorByZone` type from `ports.ts`, the
  `nextMountByZone` knob from `FakeWindowMirror` in `test-fakes.ts`, and the
  per-zone snapshot test in `overlay-controller.test.ts`. Keep the tests that
  assert `clonedCount` and `lastActivatedAt` reach the controller snapshot.
- The `HOT_CORNER_SIZE` import in `overlay-actor.ts` and the in-overlay corner
  sensor are unrelated to zones and stay as they are.

### Prose that must follow

- Doc comments in the kept files still describe the zone design or narrate
  "PoC step N" history: the header and `WindowMirrorPort` block in `ports.ts`,
  the `window-zone picker` example in `src/libs/inspector/dbus-inspector.ts`,
  and the "trigger zone" wording in `hot-corner-trigger.ts` and
  `test-fakes.ts` (say "trigger area" or "corner rect" so the word `zone` no
  longer appears in `src/`). Rewrite them to describe what the code does now;
  do not carry over the step numbering.
- `README.md` and the `description` field in `package.json` still sell the
  zone idea. Rewrite them around the new one: zatto lifts a window that sits one
  or two layers behind the active one, without moving anything on screen. The
  README's Status section is stale too ("design only, no code shipped yet");
  state that a proof of concept exists (hot corner opens an overlay that mirrors
  the open windows in place) and that the depth view is in progress. Keep the
  README short and in English; do not link to external planning documents.

The grep gate appended to `check_command` enforces the vocabulary change
across `src/`, `README.md` and `package.json`; this task file is outside those
paths and may use the old words freely.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `zone-config.ts`, `zone-layout.ts`, `app-zone-map.ts` and their tests are
      gone, and `grep -rqiE 'zone|quadrant|wm_class|packIntoZone'` finds no
      match in `src/`, `README.md` or `package.json` (gate appended to
      `check_command`).
- [x] `GnomeWindowMirror` compiles without a config parameter and still
      implements `WindowMirrorPort`; `OverlayStateMachine`, `HotCornerTrigger`,
      `DBusInspector` and `DBusReloader` are still present (class-name greps
      appended to `check_command`).
- [x] `WindowMirrorSnapshot` carries only `clonedCount` and `lastActivatedAt`,
      and the controller tests still assert both values flow into
      `OverlayController.snapshot()` (`npm run test:run`).
- [x] `npm run build`, `npm run check:strict` and `npm run test:run` pass with
      the reduced module set.

### Manual / on-hardware (verified by a human before merge)

- [ ] On a real GNOME Shell session with `npm run dev`, entering the hot corner
      opens the overlay with every open window mirrored at its own position,
      clicking a clone raises that window and closes the overlay, and Esc or
      re-entering the corner closes it without changes.
