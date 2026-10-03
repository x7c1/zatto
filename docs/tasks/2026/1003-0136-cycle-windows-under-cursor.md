---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && grep -rq 'onScroll(handler' src/ui/overlay/ports.ts && grep -rq 'cycleAt(' src/ui/overlay/ports.ts && grep -rq 'export function cycleFocus' src/ui/overlay/ && grep -rq 'export function windowsUnder' src/ui/overlay/ && grep -rq 'export class ScrollStepper' src/libs/shell/ && grep -rq 'finish' src/libs/shell/scroll-stepper.test.ts && grep -q 'cycleMs' src/ui/overlay/depth-layout.ts && grep -q 'cycleAt' src/ui/overlay/overlay-controller.test.ts && grep -q 'abortOpen' src/ui/overlay/overlay-state-machine.test.ts && grep -q 'abortOpen' src/ui/overlay/overlay-controller.test.ts && ! grep -q 'right after dismiss' src/ui/overlay/overlay-state-machine.test.ts"
assignee: null
branch: task/1003-0136-cycle-windows-under-cursor-retry-1
created_at: 2026-10-03T01:36:00Z
updated_at: 2026-10-03T02:44:00Z
---

# feat(overlay): cycle the focus through the windows under the cursor with the scroll wheel so a window one or two layers down can be brought to the front

## Overview

The depth view now opens, draws the stacking order as an oblique stack
and closes again, but it still offers only what the desktop already
offers: clicking the window you can see. The reason the depth view
exists is the window you can *almost* see — the one whose edge peeks
out one or two layers behind the window under the cursor. This task
adds the gesture that brings it forward: with the overlay open, move the
cursor to the spot where the windows overlap and turn the scroll wheel.
Each notch moves a *focus* one window deeper at that spot: the focused
window turns opaque and is drawn on top of the others, which stay
translucent where they are. Nothing moves or resizes while cycling; the
depth view is a still picture and the focus is a highlight travelling
through it. A click then raises the focused window, exactly as a click
raised the topmost clone before. The real stacking order is not touched
while cycling, and Esc or a click outside the depth view leaves the
desktop as it was.

Two leftovers from the last on-hardware round touch the same files and
ride along, see "Leftovers taken in" below.

### Design

- **Pure geometry and focus, unit-tested.** Add a framework-free module
  under `src/ui/overlay/` (next to `depth-layout.ts`) with:
  - `windowsUnder(point, frames, layout): number[]` — the indices of
    the frames whose *drawn* rect contains `point`. `frames` are the
    work-area-relative frame rects in bottom-to-top stacking order,
    `layout` is the `DepthViewLayout` computed for them at mount, and a
    frame's drawn rect is its frame rect moved by the clone's offset and
    then put through the container transform (`scale`, `translationX`,
    `translationY`). The frame rect, not the buffer rect, is used so
    shadows and invisible borders do not count as the window. The point
    is in work-area coordinates. The result is in the same order as
    `frames`, so its last entry is the frontmost window under the cursor.
    Because the layout never changes while the overlay is open, the
    group under a resting cursor is the same on every notch.
  - `cycleFocus(group, focused, direction): number` — `group` is the
    result of `windowsUnder` (bottom to top, at least two entries),
    `focused` the index currently focused or `null`. With `focused`
    `null` or not in the group, the focus is taken to sit on the
    frontmost member (the window the user sees there), so `forward`
    returns the member directly behind it and `backward` the deepest
    member. Otherwise `forward` returns the next deeper member, wrapping
    from the deepest to the frontmost, and `backward` the reverse.
  - Tests: a point over two overlapping windows and a third elsewhere
    returns the two; the container scale and translation are applied
    (a point that misses the untransformed frame hits the scaled one);
    a point in the offset-only strip of a deeper window hits that window
    alone; `cycleFocus` from `null` goes to the second member, walks
    forward through a three-member group and wraps, walks backward and
    wraps, and treats a `focused` outside the group like `null`.
- **Scroll steps from the stage grab.** `ModalGrabPort` gains
  `onScroll(handler: (scroll: ScrollStep) => void)`, registered like
  `onEsc`, where `ScrollStep` is `{ x: number; y: number; direction:
  'up' | 'down' }` in stage coordinates. `GnomeModalGrab.onCapturedEvent`
  handles `Clutter.EventType.SCROLL`: a scroll whose target actor is
  inside the overlay (same containment test as the outside-press check)
  is turned into zero or more steps and stopped (`EVENT_STOP`) so it
  does not reach anything beneath; a scroll outside the overlay (top bar,
  dock) propagates untouched and does not cycle. Events flagged as
  pointer-emulated are skipped, as gnome-shell's own scroll handlers do,
  so one notch is not counted twice. `Clutter.ScrollDirection.UP` and
  `DOWN` are one step each; `LEFT` and `RIGHT` are ignored; `SMOOTH`
  goes through a `ScrollStepper` (a framework-free class under
  `src/libs/shell/`, unit-tested) that accumulates `get_scroll_delta()`'s
  dy and emits one step per whole unit, resetting its remainder when the
  sign changes. **When the event carries scroll finish flags** (the
  fingers left the touchpad, `get_scroll_finish_flags()` is not `NONE`),
  the stepper's remainder is reset after the event is processed, so a
  fraction left over from one swipe cannot turn the first touch of the
  next swipe into a step. The stepper is also reset when the grab is
  acquired. The pointer position comes from `event.get_coords()`. The
  pace (one unit = one step) is a starting value for the on-hardware
  check; a touchpad factor is not part of this task.
- **Controller wiring and state coverage.** The controller registers
  `onScroll` in `enable()` and forwards a step to
  `windowMirror.cycleAt({ x, y }, direction)` only while the FSM is
  `open`; `down` maps to `forward` (the focus goes one window deeper),
  `up` to `backward`. Steps that arrive while `closed`, `opening` or
  `closing` are dropped. `FakeModalGrab` gains a `fireScroll(step)`
  helper and `FakeWindowMirror` records every `cycleAt` call, so the
  controller tests cover all four states.
- **Mirror: move the focus, move nothing else.** `WindowMirrorPort`
  gains `cycleAt(point, direction): boolean`, returning whether the
  focus changed. `GnomeWindowMirror` keeps the layout and the clones'
  positions exactly as `mount()` placed them for as long as the overlay
  is open — `cycleAt` never recomputes the layout, never changes the
  container transform and never moves or resizes a clone. It converts the
  stage point to work-area coordinates, computes the group with
  `windowsUnder` against the mount layout, returns `false` for fewer than
  two members, otherwise applies `cycleFocus`. The newly focused clone is
  raised to the top of the container's children (Clutter paints in child
  order; without this an opaque clone would still be covered by the
  translucent ones in front of it) and its opacity eases to 255 over
  `DEPTH_VIEW_TUNING.cycleMs` — a new knob, 150 ms to start with. The
  previously focused clone, if any, eases back to the layout opacity and
  is put back at its mount position among the children. At most one
  clone is focused at a time; a scroll over a different spot moves the
  focus there. Without animations the values are set directly. `mount()`
  starts with no focus.
- **Close in the real order.** When a close starts, put the children
  back in mount order, with the clicked clone on top when the close was
  an activation (as today), before easing them back onto their windows.
  The real windows then reappear under clones stacked the way the
  windows are. The close ease already takes every clone to opacity 255,
  so the focus needs no separate undo. `mount()` clears the focus.
- **Inspect.** `WindowMirrorSnapshot` gains `lastCycledAt: number | null`
  (epoch ms of the last `cycleAt` that moved the focus) so a scroll that
  does not reach the mirror can be told from one that finds nothing to
  cycle on hardware. Update `FakeWindowMirror`, the snapshot tests and
  the snapshot shape documented in `CLAUDE.md`.
- **README.** In the Status section, replace "Cycling the windows under
  the cursor with the scroll wheel is the next step." with a sentence
  that says the scroll wheel moves a focus through the windows that
  overlap under the cursor, one per notch, the focused window turning
  opaque and coming to the front of the picture while nothing moves, and
  that a click raises the focused window. Keep the README short and do
  not link to planning documents outside the repository.

### Leftovers taken in

- **Opening that throws leaves the overlay half open.**
  `OverlayController.handleOpen()` restores the real windows and
  rethrows, but the grab stays held, the dimmer stays shown, the clones
  stay mounted and the FSM stays in `opening`, which ignores every later
  toggle, so the overlay is stuck until the extension is disabled. Add
  `OverlayStateMachine.abortOpen()`: from `opening` it returns to
  `closed` without emitting an event (the glue has already torn down
  what it set up) and restarts the debounce window, so the synthesized
  enter that may follow the teardown cannot reopen it; a no-op in any
  other state. In the `catch`, after `realWindows.restore()`, release the
  grab, `unmount({ immediate: true })` the clones, hide the actor, call
  `abortOpen()`, then rethrow. Extend the existing "restores the real
  windows and rethrows" controller test: the grab is released, the actor
  is not visible, the snapshot reports `closed`, and a hot-corner enter
  after the debounce window opens the overlay again.
- **`dismiss()` restarts the debounce window for nothing.** `dismiss()`
  moves to `closing`, which rejects toggles by state, and the
  `commitClosed()` that always follows restarts the window itself; the
  restart in `dismiss()` is therefore unobservable, and the tests named
  "right after dismiss" / "debounceMs after dismiss" actually exercise
  `commitClosed()`. Remove the restart from `dismiss()` and the sentence
  about it in its doc comment and in the module header, and rename the
  two tests so they say what they test (a close that was started by
  `dismiss()` and landed with `commitClosed()`); the gate asserts that no
  test is still named "right after dismiss".

Out of scope: a touchpad pace factor, horizontal scroll, cycling by
keyboard, and the half-second in which the hot corner does not respond
after a close (it needs a feel judgement on hardware first).

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `windowsUnder` and `cycleFocus` exist as exported functions under
      `src/ui/overlay/` (grep gates) and their tests cover the cases
      listed under "Pure geometry and focus": transform applied,
      offset-only strip, focus from `null`, forward and backward with
      wrap-around, a stale `focused` outside the group
      (`npm run test:run`).
- [x] `ModalGrabPort.onScroll` and `WindowMirrorPort.cycleAt` exist
      (grep gates on `ports.ts`), `ScrollStepper` is an exported class
      under `src/libs/shell/` with tests for one step per whole unit of
      smooth delta, for the remainder reset on sign change and for the
      reset at a gesture's finish (a test naming "finish", grep gate),
      and `DEPTH_VIEW_TUNING.cycleMs` exists (grep gate).
- [x] The controller forwards a scroll step to `cycleAt` only while
      `open` and drops it while `closed`, `opening` and `closing`
      (controller tests reference `cycleAt`, grep gate, and the four
      states each have a test).
- [x] `OverlayStateMachine.abortOpen()` returns `opening` to `closed`,
      restarts the debounce window and is a no-op elsewhere (FSM tests
      reference `abortOpen`, grep gate); the controller test for a
      failing open asserts the grab is released, the actor hidden, the
      state `closed` and that the overlay opens again afterwards
      (controller tests reference `abortOpen`, grep gate).
- [x] No FSM test is still named "right after dismiss" (negative grep
      gate), and `dismiss()` no longer writes `lastAcceptedToggleMs`.
- [x] `WindowMirrorSnapshot.lastCycledAt` round-trips through the
      controller snapshot's JSON test, and `npm run build`,
      `npm run check:strict` and `npm run test:run` pass.

### Manual / on-hardware (verified by a human before merge)

- [ ] On a real GNOME Shell session with `npm run dev`, with two or
      three windows overlapping, opening the overlay and scrolling down
      over the overlap makes the next window at that spot opaque and
      brings it to the front of the picture on each notch, scrolling up
      reverses it, and no clone moves or changes size while cycling.
- [ ] Clicking the focused clone raises that window and closes the
      overlay; Esc or a click on the top bar after cycling closes the
      overlay with the desktop's stacking order unchanged, and the
      clones land in the real order without a visible pop after landing.
- [ ] Scrolling over the top bar while the overlay is open does not
      cycle anything and still reaches the top bar; a touchpad
      two-finger swipe over the overlap moves the focus, and a light
      touch right after a swipe does not move it again. Note how many
      windows one comfortable swipe advances, for the pace decision.
