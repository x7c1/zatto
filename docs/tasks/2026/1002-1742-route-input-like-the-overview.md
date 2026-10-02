---
status: completed
pipeline_phase: null
plan: null
base_ref: task/1002-1720-fit-overlay-to-work-area
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && grep -q 'global.stage' src/libs/shell/gnome-modal-grab.ts && ! grep -rq 'onCornerReenter' src/ && ! grep -q 'motion-event' src/ui/overlay/overlay-actor.ts && grep -q 'onOutsidePress' src/ui/overlay/overlay-controller.test.ts && grep -q 'right after commitClosed' src/ui/overlay/overlay-state-machine.test.ts && grep -rq 'class GnomeWindowMirror' src/ui/overlay/"
assignee: null
branch: task/1002-1742-route-input-like-the-overview
created_at: 2026-10-02T17:42:00Z
updated_at: 2026-10-02T18:05:00Z
---

# feat(overlay): grab the stage like the Activities Overview so the top bar and the dock stay usable and the hot corner cannot reopen a closing overlay

## Overview

Two problems showed up on hardware once the overlay hid the real windows,
animated the transition and confined itself to the work area.

First, the top bar and the dock now look exactly as they do on the desktop,
but every click on them is swallowed: the modal grab is taken on the
monitor-wide dimmer, and a Clutter grab routes events that land outside the
grabbed actor's subtree to the grab actor itself. The Activities Overview
takes its grab on the stage (`Main.pushModal(global.stage, ...)` in
`Overview._show()`), which is why the top bar and the dock keep working
while it is open and why clicking a dock icon launches the app and closes
the overview. This task adopts the same approach.

Second, the overlay sometimes reopens by itself right after closing and
keeps cycling open and closed, which looks like the close animation never
ending. The chain is: the close ease lands about 250 ms after the close was
requested, the dimmer (a reactive actor under the pointer) is hidden, Clutter
repicks and synthesizes an `enter-event` on whatever is now under the
pointer, and if the pointer rests in the hot corner the trigger fires a
toggle. The debounce window is measured from the close request and has
expired by then, so the toggle is accepted and the overlay reopens; a small
pointer movement in the corner then closes it again, and so on. Before the
animation the dimmer was hidden synchronously inside the debounce window,
which masked the problem. The fix is to restart the debounce window when the
close actually lands, so nothing synthesized by the teardown can reopen the
overlay, and to let an Esc dismissal count as a toggle for the same purpose.

### Design

- **Grab the stage.** `GnomeModalGrab.acquire()` calls
  `Main.pushModal(global.stage)` instead of grabbing the dimmer, and
  connects its `captured-event` handler on `global.stage`. The
  `getGrabActor` constructor callback is no longer needed; `extension.ts`
  and `OverlayActor.getGrabActor()` are updated accordingly. Keep the
  default action mode (`Shell.ActionMode.NONE`, which `pushModal` applies
  when none is given), so Shell keybindings stay inactive as today. Esc is
  still handled in the captured-event handler.
- **Presses outside the overlay close it and pass through.** `ModalGrabPort`
  gains `onOutsidePress(handler)`, registered like `onEsc`. In the same
  captured-event handler, a `BUTTON_PRESS` or `TOUCH_BEGIN` whose target
  actor (`global.stage.get_event_actor(event)`) is not the overlay actor or
  one of its descendants calls the handler and returns `EVENT_PROPAGATE`, so
  the top bar or the dock receives the press as usual: clicking a dock icon
  launches or raises the app and the overlay closes. The controller wires
  the handler to `fsm.dismiss()`. The port needs the overlay actor for the
  containment check, so `GnomeModalGrab` takes a `getOverlayActor` callback
  in place of the old `getGrabActor` one.
- **The dimmer shrinks to the work area.** With a stage grab, a monitor-wide
  reactive dimmer added as chrome after the panel and the dock would still
  be painted above them and would intercept their clicks. `OverlayActor`
  therefore sizes the dimmer itself to the work area (`fitGeometry` places
  the dimmer at the work area in stage coordinates and the shade and the
  clone container at its origin). Presses on the shade, inside the work
  area but not on a clone, are still swallowed by the reactive dimmer, as
  today.
- **Drop the in-overlay corner sensor.** The dimmer's `motion-event`
  corner check existed only because the dimmer grab kept events away from
  the chrome `HotCornerTrigger`. Under a stage grab the trigger receives
  its `enter-event` while the overlay is open, so one trigger opens and
  closes the overlay. Remove `OverlayActorPort.onCornerReenter`, the
  sensor code, the `cornerLatched` state and the `HOT_CORNER_SIZE` export's
  "re-entry sensor" rationale; update `FakeOverlayActor` and the controller
  wiring and tests.
- **Restart the debounce when the close lands.** `OverlayStateMachine.commitClosed()`
  sets `lastAcceptedToggleMs` to `now()`, and `dismiss()` does the same
  when it accepts, so a toggle within `debounceMs` of either is rejected.
  The hot-corner `enter-event` that Clutter synthesizes when the dimmer
  and the clones disappear arrives in that window and is dropped; a
  deliberate re-entry after the window opens normally. Add FSM tests: a
  toggle right after `commitClosed()` is rejected and one after
  `debounceMs` is accepted; the same pair after `dismiss()`.
- **Hot corner under the dock.** Ubuntu's default dock is vertical on the
  left, and the bottom-left corner lies at its lower end. Leave the trigger
  where it is; this task does not move it.
- **Operation × state coverage.** States: `closed`, `opening`, `open`
  (easing in or settled), `closing`. Cover with controller tests: an
  outside press while `open` releases the grab and starts the close (same
  path as Esc); an outside press while `closing` or `closed` does nothing;
  a hot-corner enter while `open` closes (existing toggle test) and one
  during `closing` is ignored; Esc still dismisses from `open`.
- **README.** In the Status section, say that the top bar and the dock stay
  usable while the overlay is open and that clicking outside the depth
  view closes it. Keep the README short and do not link to planning
  documents outside the repository.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `GnomeModalGrab` grabs `global.stage` (grep gate) and
      `ModalGrabPort.onOutsidePress` is wired by the controller and
      exercised by the controller tests (grep gate on `onOutsidePress` in
      `overlay-controller.test.ts` plus `npm run test:run`): an outside
      press while open dismisses, while closing or closed does nothing.
- [x] The in-overlay corner sensor is gone: no `onCornerReenter` anywhere
      under `src/` and no `motion-event` handler in `overlay-actor.ts`
      (negative grep gates), and the controller tests still cover closing
      by hot-corner re-entry through the trigger.
- [x] `OverlayStateMachine` restarts the debounce on `commitClosed()` and
      `dismiss()`: tests named with "right after commitClosed" (grep gate)
      and the `dismiss()` counterpart assert the rejection inside and the
      acceptance after `debounceMs`.
- [x] `npm run build`, `npm run check:strict` and `npm run test:run` pass
      and `class GnomeWindowMirror` is still present.

### Manual / on-hardware (verified by a human before merge)

- [ ] On a real GNOME Shell session with `npm run dev`, with the overlay
      open, clicking a dock icon launches or raises that app and the
      overlay closes; clicking the top bar's clock or system menu opens
      that menu and the overlay closes.
- [ ] Leaving the pointer in the hot corner after opening, and moving it
      slightly, does not make the overlay cycle open and closed; after a
      close the overlay stays closed until the corner is entered again.
- [ ] Esc, corner re-entry and clone click still close the overlay, and a
      click on the shade between clones does nothing.
