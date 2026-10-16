---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && grep -rq 'mountShouldThrow' src/ui/overlay/ && grep -rq 'acquireShouldThrow' src/ui/overlay/"
assignee: null
branch: task/1016-2354-roll-back-a-failed-open
created_at: 2026-10-16T14:54:12Z
updated_at: 2026-10-16T15:30:00Z
---

# fix(overlay): roll back a failed open whichever step throws

## Overview

`OverlayController.handleOpen()` (`src/ui/overlay/overlay-controller.ts`)
runs `actor.show()`, `modalGrab.acquire()`, `windowMirror.mount()`,
`realWindows.hide()` and `fsm.commitOpened()` in that order. Only the
last two sit inside the `try` that rolls the open back (restore the real
windows, release the grab, unmount the clones immediately, hide the actor,
`fsm.abortOpen()`, rethrow). If `mount()` throws, for example on a
Clutter error while cloning a window, the overlay actor stays shown, the
modal grab stays held, and the state machine stays in `opening`, which
ignores every toggle: the user is left with a dimmed screen that no input
closes.

Make every step of the open roll back on a throw. Each rollback step must
undo only what has already been set up (do not release a grab that was
never acquired, do not restore windows that were never hidden), the FSM
must end in `closed` via `abortOpen()`, and the original error must
propagate unchanged. Keep the existing behaviour and test for a throw
after `hide()`.

States the open can fail in, each needing its own test: `actor.show()`
throws; `modalGrab.acquire()` throws; `windowMirror.mount()` throws
(possibly after some clones were created; `unmount({ immediate: true })`
must cope with that); `realWindows.hide()` / `fsm.commitOpened()`
throws (the existing case). Out of scope: a throw inside `handleClose()`.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] The test fakes can make `mount()` and `acquire()` throw
      (`mountShouldThrow`, `acquireShouldThrow` in
      `src/ui/overlay/test-fakes.ts`; gates in `check_command`).
- [x] For each failing step above, a test in
      `overlay-controller.test.ts` asserts that the error propagates, the
      FSM ends in `closed`, the actor is hidden, the grab is released iff
      it was acquired, the real windows are restored iff they were hidden,
      and the next hot-corner enter after the debounce opens the overlay
      again.
