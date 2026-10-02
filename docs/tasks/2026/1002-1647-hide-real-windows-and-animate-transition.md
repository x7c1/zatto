---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && grep -rq 'top_window_group' src/ui/overlay/ && grep -rq 'enable_animations' src/ && grep -rqE '\\.ease\\(' src/ui/overlay/ && grep -rq 'realWindows' src/ui/overlay/overlay-controller.test.ts && grep -rq 'class GnomeWindowMirror' src/ui/overlay/"
assignee: null
branch: task/1002-1647-hide-real-windows-and-animate-transition
created_at: 2026-10-02T16:47:00Z
updated_at: 2026-10-02T17:18:00Z
---

# feat(overlay): hide the real windows and animate between the desktop and the depth view

## Overview

The depth view (PR #15) paints a translucent clone of every window at an
offset from the window itself, while the real windows stay visible
underneath. On hardware this reads as a double image, not as the desktop
turning into a depth view. The intended behaviour is the one GNOME Shell's
Activities Overview has: the moment the overview opens, the real window
actors are hidden and their clones, which start exactly where the windows
are, slide into the overview layout; on close the clones slide back onto
the windows' positions and the real windows reappear the instant the clones
land. This task brings the overlay to that behaviour, as a pseudo-3D
version: the clones ease between their on-screen rects and their depth-view
placement from `computeDepthLayout()`.

The two halves cannot ship separately. Hiding the real windows without the
ease is a hard cut, and the ease without hiding makes the clones fly past
their still-visible sources (that is what PR #11 showed and what PR #12 set
out to fix). PR #12 (`feat/poc-step5d-hide-real-windows`) is the reference
for hiding the real windows: its port shape and its safety contract are
reused here, its config kill switch and fade are not. PR #12 is closed in
favour of this task because it conflicts with the zone removal in PR #14.

### Design

- **Real windows port.** Add `RealWindowsPort` to `src/ui/overlay/ports.ts`
  with `hide()`, `show()`, `restore()` and `snapshot()` (snapshot:
  `{ hidden: boolean; lastRestoredAt: number | null }`), and a production
  implementation `GnomeRealWindows` in `src/ui/overlay/gnome-real-windows.ts`
  that flips `visible` on both `global.window_group` and
  `global.top_window_group`, as `LayoutManager._updateVisibility()` in
  gnome-shell's `js/ui/layout.js` does for the overview. `hide()` and
  `show()` are synchronous and do not fade: the clones cover the sources
  exactly at both moments, so a fade would only show the double image this
  task removes. `Clutter.Clone` keeps painting a hidden source.
- **Safety contract.** `restore()` is synchronous, idempotent and always
  safe: it calls `remove_all_transitions()` on both groups and sets
  `visible = true` and `opacity = 255`. The controller calls it as the first
  action of `enable()` (a previous instance may have died with the desktop
  hidden), as the first action of `disable()` (before any teardown that may
  throw), and from a `catch` around the part of `handleOpen()` that runs
  after `hide()` (restore, then re-throw). Follow PR #12's
  `GnomeRealWindowsVisibility` for these three call sites.
- **Open transition.** `GnomeWindowMirror.mount()` creates each clone at its
  window's monitor-relative frame rect with opacity 255 and the container
  at identity, then eases the clone's `x`, `y` and `opacity` to the
  placement from `computeDepthLayout()` and the container's `scale_x`,
  `scale_y`, `translation_x`, `translation_y` to the fit transform. All of
  `handleOpen()` runs in one call stack (show the overlay, acquire the grab,
  mount the clones, hide the real windows, commit), so no frame is painted
  between mounting the clones and hiding the sources. The FSM commits
  `opened` synchronously as today; the ease runs in the `open` state.
- **Close transition.** `WindowMirrorPort.unmount()` gains an options
  argument `{ immediate?: boolean; onDone?: () => void }`. Without
  `immediate`, it cancels any ease in flight, eases every clone back to its
  frame rect and opacity 255 and the container back to identity from
  wherever they currently are, tears the clones down when the ease lands,
  and then calls `onDone` exactly once. With `immediate`, or when
  animations are disabled, it tears down synchronously and calls `onDone`
  before returning. `handleClose()` releases the grab, starts the overlay
  fade-out, and calls `unmount` with an `onDone` that shows the real
  windows and then commits `closed`. While the close ease runs the FSM is
  in `closing`, so a hot-corner toggle or Esc during it is ignored by the
  existing guard; `disable()` uses `immediate` and runs `restore()` first.
- **Activated window on top.** When a clone is clicked, move that clone to
  the top of the container (`set_child_above_at(clone, null)`) before
  activating the window, so the clone paint order matches the stacking
  order the real windows will have when they reappear and the chosen window
  does not pop to the front after landing.
- **Overlay shade.** The dimmer is the modal grab actor and the parent of
  the clone container, so easing its opacity would fade the clones too.
  Give `OverlayActor` a separate full-monitor shade child below the clone
  container that carries the dim colour (`DIMMER_STYLE` moves to it), keep
  the dimmer itself transparent, and ease only the shade's opacity: in on
  `show()`, out on `hide()`, after which the dimmer is set invisible.
  `destroy()` removes transitions before destroying. `isVisible()` keeps
  reporting intent (`true` from `show()` until `hide()`).
- **One animation switch, one duration.** Add `shouldAnimate()` in
  `src/libs/shell/animations.ts` returning `St.Settings.get().enable_animations`,
  and use it from the mirror and the actor; with animations off every ease
  becomes a synchronous set. Add `transitionMs: 250` to `DEPTH_VIEW_TUNING`
  (gnome-shell's overview uses 250 ms) and use
  `Clutter.AnimationMode.EASE_OUT_QUAD` in both places; the mode stays in
  the `gi://` modules because `depth-layout.ts` is pure.
- **Operation × state coverage.** The overlay can be `closed`, `opening`,
  `open` with the open ease in flight, `open` settled, or `closing` with
  the close ease in flight; the extension can also be enabled while a
  previous instance left the real windows hidden. Cover with controller
  tests: open from `closed` mounts, then hides, then commits; each close
  path (corner re-entry, Esc, clone click) from `open` releases the grab,
  unmounts with `onDone`, and shows the real windows only inside `onDone`;
  a toggle while `closing` changes nothing; `disable()` from `open` and
  from `closing` calls `restore()` first and unmounts immediately;
  `enable()` calls `restore()` before anything else; an exception after
  `hide()` in `handleOpen()` calls `restore()` and propagates. For the
  mirror, `mount()` while a close ease is in flight must first tear the
  old clones down immediately (the existing defensive `unmount()` at the
  top of `mount()`, now with `immediate: true`); this is covered by the
  on-hardware list, since the mirror runs on Clutter.
- **Fakes and snapshot.** Add `FakeRealWindows` recording the order of
  `hide` / `show` / `restore` calls; let `FakeWindowMirror.unmount()` record
  its options and call `onDone` synchronously unless a test defers it to
  simulate an ease in flight. Add `realWindows` to the controller snapshot
  so the Inspect endpoint reports `hidden` and `lastRestoredAt`, and extend
  the snapshot round-trip test.
- **Keep the seam intact.** The controller still depends only on ports.
  `extension.ts` instantiates `GnomeRealWindows` and passes it as the fifth
  port. `HotCornerPort`, `ModalGrabPort` and `OverlayActorPort` keep their
  shapes.
- **README.** In the Status section, say that opening the overlay hides the
  real windows and slides their clones into the depth view, and that
  closing slides them back; name scroll-wheel cycling as the next step.
  Keep the README short and do not link to planning documents outside the
  repository.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `RealWindowsPort` exists in `src/ui/overlay/ports.ts`, its production
      implementation under `src/ui/overlay/` flips `visible` on both
      `global.window_group` and `global.top_window_group` (grep gate on
      `top_window_group` under `src/ui/overlay/`), and `restore()` resets
      both groups synchronously.
- [x] The controller tests in `src/ui/overlay/overlay-controller.test.ts`
      cover the operation × state list above through a `FakeRealWindows`
      (grep gate on `realWindows` in that file plus `npm run test:run`):
      hide after mount on open, show only inside `unmount`'s `onDone` on
      every close path, `restore()` first on `enable()` and `disable()`,
      `restore()` on an exception after `hide()`, and no change on a
      toggle while `closing`.
- [x] `GnomeWindowMirror` and `OverlayActor` ease with `actor.ease()` (grep
      gate on `.ease(` under `src/ui/overlay/`) and consult one shared
      `enable_animations` check (grep gate under `src/`), and the mirror's
      `unmount` honours `immediate` and calls `onDone` exactly once on
      both paths.
- [x] `DEPTH_VIEW_TUNING.transitionMs` exists and the depth-layout tests
      still pass unchanged in behaviour (the layout function's inputs and
      outputs do not move).
- [x] `npm run build`, `npm run check:strict` and `npm run test:run` pass
      and `class GnomeWindowMirror` is still present.

### Manual / on-hardware (verified by a human before merge)

- [ ] On a real GNOME Shell session with `npm run dev`, entering the hot
      corner makes the real windows disappear with no frame of double
      image, and the clones slide from the windows' positions into the
      depth view over about 250 ms while the shade fades in.
- [ ] Closing by corner re-entry, by Esc and by clicking a clone each
      slides the clones back onto the windows' positions, and the real
      windows reappear the instant the clones land, with no flash and no
      pop of the clicked window to the front.
- [ ] Entering the hot corner during the close ease does nothing, and
      entering it again after the close has landed opens normally with
      the clones starting from the windows' positions.
- [ ] With `gsettings set org.gnome.desktop.interface enable-animations false`
      the open and close snap with no ease and the real windows are still
      hidden and shown correctly; restore the setting afterwards.
- [ ] Disabling the extension while the overlay is open
      (`gnome-extensions disable zatto@x7c1.github.io`) and running
      `npm run dev` while it is open both bring the real windows back
      immediately and leave the desktop usable.
- [ ] The Inspect endpoint reports `realWindows.hidden: true` while the
      overlay is open and `false` after it closes.
