---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && grep -rq 'onMotion(handler' src/ui/overlay/ports.ts && grep -rq 'hoverAt(' src/ui/overlay/ports.ts && grep -rq 'export function computeStripLayout' src/ui/overlay/ && grep -rq 'export function focusWithin' src/ui/overlay/ && grep -rq 'CYCLE_STRIP_TUNING' src/ui/overlay/ && grep -rq 'class CycleStrip' src/ui/overlay/ && grep -q 'hoverAt' src/ui/overlay/overlay-controller.test.ts && grep -q 'stripCount' src/ui/overlay/overlay-controller.test.ts"
assignee: null
branch: task/1003-1317-cycle-strip-retry-1
created_at: 2026-10-03T13:17:00Z
updated_at: 2026-10-03T14:32:00Z
---

# feat(overlay): show the windows under the cursor as a strip of thumbnails along the bottom of the depth view, highlighting the focused one

## Overview

Cycling works, but the user cannot see what they are cycling through.
Resting the cursor on a spot where windows overlap tells them nothing
about which windows are there or in what order, and after a notch the only
feedback is that one large clone turned opaque. Whether the window they
want is one notch away or four is a guess.

This task adds a strip of live thumbnails along the bottom of the depth
view. As soon as the cursor rests on a window, the strip shows that
window and the windows overlapping it there as small clones in a row, the
frontmost on the left and each deeper one to its right; a single window
gives a strip of one, so the strip always names what a click or Enter
would pick. The thumbnail of
the window the focus sits on carries an accent frame and its title is
written under the strip. Each scroll notch moves the frame one thumbnail
to the right (`forward`) or left (`backward`), wrapping, in step with the
large clone that turns opaque. The user sees at a glance how many notches
the window they want is away. Once shown, the strip stays: moving the
cursor over an empty spot changes nothing, moving it onto other windows
rebuilds the strip for them, and the strip goes away when the overlay
closes. It is drawn over
the clones, so the cursor can travel from the overlap down to the strip
and click a thumbnail, which raises that window and closes the overlay
like clicking the large clone. Scrolling while the cursor is on the strip
cycles the strip's group.

Nothing else in the depth view changes: the large clones keep their
positions and the cycling behaviour from the previous change.

### Design

- **Pure layout and order, unit-tested.** Add a framework-free module
  under `src/ui/overlay/` (next to `depth-layout.ts`) with:
  - `CYCLE_STRIP_TUNING` — the strip's knobs, starting values for the
    on-hardware check: `thumbHeightPx: 120`, `thumbGapPx: 12`,
    `paddingPx: 12`, `bottomMarginPx: 24` (distance from the work area's
    bottom edge), `fadeMs: 150`.
  - `computeStripLayout(sizes, area, tuning): StripLayout` — `sizes` are
    the members' window sizes (width, height of the rect the thumbnail
    mirrors) in strip order, `area` the work area size. Every thumbnail
    gets height `thumbHeightPx` and the width that keeps its aspect; the
    thumbnails sit in a row with `thumbGapPx` between them inside
    `paddingPx`; the strip is centred horizontally and its bottom edge is
    `bottomMarginPx` above the work area's bottom. If the row would be
    wider than the work area minus two margins, every thumbnail is scaled
    down uniformly so it fits. The result has the strip rect and one
    thumbnail rect per member, all relative to the work area. Tests: two
    members of different aspect get the same height and widths by
    aspect; the strip is centred; a row too wide is scaled down to fit and
    stays centred; an empty list gives an empty strip.
  - `focusWithin(group, focused): number` in `depth-cycle.ts` — `group`
    is a `windowsUnder` result (bottom to top) and `focused` the focused
    index or `null`; returns the position of the highlighted thumbnail in
    strip order (front to back): the position of `focused` when it is in
    the group, else 0 (the frontmost, where the focus is taken to sit, as
    `cycleFocus` does). Tests: `null` and a stale `focused` give 0; a
    focused member two behind the front gives 2; consistent with
    `cycleFocus` so that one `forward` step from `null` highlights
    position 1.
- **Pointer motion from the stage grab.** `ModalGrabPort` gains
  `onMotion(handler: (point: Point) => void)`, registered like `onEsc`.
  `GnomeModalGrab.onCapturedEvent` calls it for every `MOTION` event
  while the grab is held, with `event.get_coords()` in stage coordinates,
  and lets the event propagate; motion over the top bar or the dock is
  reported too (the mirror then finds no window under it and leaves the
  strip as it is). No throttling: `windowsUnder` is a handful of
  rectangle tests.
- **Controller wiring and state coverage.** The controller registers
  `onMotion` in `enable()` and forwards the point to
  `windowMirror.hoverAt(point)` only while the FSM is `open`, dropping it
  in `closed`, `opening` and `closing` — the same guard as `onScroll`.
  `FakeModalGrab` gains `fireMotion(point)`, `FakeWindowMirror` records
  every `hoverAt` call and exposes a settable `stripCount` for the
  snapshot, and the controller tests cover all four states.
- **Mirror: track the hover group.** `WindowMirrorPort` gains
  `hoverAt(point: Point): void`. `GnomeWindowMirror` converts the point to
  work-area coordinates and, when the point lies on the strip itself,
  does nothing (the strip is drawn over the clones, so a pointer on it is
  not on the windows beneath; `CycleStrip.covers(point)` answers this).
  Otherwise it computes the group with `windowsUnder` against the mount
  layout and compares it with the group shown last time. With no member
  it does nothing — the strip, if shown, stays as it is. With a changed
  membership of one or more it shows the strip for the new group, in
  front-to-back order (the reverse of `windowsUnder`'s order),
  highlighting `focusWithin(group, focused)`. With the same membership it
  does nothing. (Cycling still needs two or more: `cycleAt` is
  unchanged.) The strip is never hidden by hovering; only closing hides
  it. `cycleAt` keeps its behaviour for a point on the clones and, when it
  moves the focus, tells the strip the new highlight position; for a
  point on the strip it cycles the strip's group (the hover group shown)
  instead of the clones beneath, so scrolling while the cursor rests on
  the strip walks the thumbnails. `mount()` starts with no hover group and
  a hidden strip; closing (both `unmount` paths) hides the strip and
  forgets the group.
- **The strip actor.** Add `CycleStrip` under `src/ui/overlay/`
  (production code, `gi://` allowed) owned by `GnomeWindowMirror` and
  constructed in `extension.ts`, with `show(members, highlighted)`,
  `setHighlight(position)`, `covers(point)`, `hide()` and `destroy()`. A
  member is the
  window actor to clone, the size of its buffer rect, its `Meta.Window`
  and the callback to run when its thumbnail is clicked. `show` destroys
  the previous thumbnails and builds new ones: a background `St.Widget`
  (dark translucent, rounded corners, like the Alt+Tab popup) sized to
  the strip rect, one reactive `Clutter.Clone` per member sized to its
  thumbnail rect (a clone scales its source, so the thumbnail is the
  whole window actor, client-side shadows included — accepted for now),
  an `St.Widget` frame drawn around the highlighted thumbnail (2 px
  border, light colour, rounded), and an `St.Label` centred under the
  strip with the highlighted window's title (`Meta.Window.get_title()`,
  one line, ellipsized to the strip's width). `setHighlight` moves the
  frame and rewrites the label. A press on a thumbnail stops the event,
  runs the member's callback (the mirror passes the same activate-and-
  close path the large clones use) and returns `EVENT_STOP`. `show` fades
  the strip in and `hide` fades it out over `fadeMs`; without animations
  the values are set directly. `hide` and `destroy` must be idempotent.
- **Where the strip lives.** `OverlayActor` gains a second
  `Clutter.FixedLayout` container above the clone container, sized like
  it and non-reactive, returned by `getChromeContainer()`; the strip is
  parented there so it is drawn over the large clones and its thumbnails
  can be reactive without changing the clones' input routing.
  `extension.ts` passes `() => actor.getChromeContainer()` to the strip.
- **Inspect.** `WindowMirrorSnapshot` gains `stripCount: number` — how
  many thumbnails the strip currently shows, 0 when hidden — so an
  on-hardware check can tell a strip that never appeared from a group
  that was too small. Update `FakeWindowMirror`, the snapshot JSON test
  and the snapshot shape in `CLAUDE.md`.
- **README.** In the Status section, after the sentence about cycling,
  add one sentence: resting the cursor on overlapping windows shows them
  as a row of thumbnails along the bottom, frontmost first, with the
  focused one framed and titled; the strip stays until another overlap is
  hovered or the overlay closes, and clicking a thumbnail raises that
  window. Keep the README short.

### Adjustments from the on-hardware check

- The highlight is a translucent rounded pad behind the focused
  thumbnail and its icon, as the Alt+Tab switcher marks its selection,
  instead of a frame around it; `thumbGapPx` grew to 18 so the pad stays
  clear of the neighbouring thumbnails.
- Each thumbnail carries its app icon centred on its top edge
  (`iconSizePx`), the Activities Overview's window-preview icon moved
  from the bottom edge to the top.
- The title is drawn as the Shell's `window-caption` pill, centred under
  the strip in a reserved `titleHeightPx` band above `bottomMarginPx`, so
  it is legible over any clone and no longer touches the bottom edge.

Out of scope: thumbnails cropped to the frame rect (shadows excluded),
keyboard navigation of the strip, and the touchpad pace factor.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `computeStripLayout` and `CYCLE_STRIP_TUNING` exist under
      `src/ui/overlay/` (grep gates) with tests for equal heights and
      aspect widths, centring, scale-to-fit and the empty list; and
      `focusWithin` exists (grep gate) with tests for `null`, a stale
      `focused`, a member two behind the front and consistency with
      `cycleFocus` (`npm run test:run`).
- [x] `ModalGrabPort.onMotion` and `WindowMirrorPort.hoverAt` exist (grep
      gates on `ports.ts`), and the controller forwards motion to
      `hoverAt` only while `open` and drops it while `closed`, `opening`
      and `closing` (controller tests reference `hoverAt`, grep gate, one
      test per state).
- [x] `class CycleStrip` exists under `src/ui/overlay/` (grep gate) and
      `WindowMirrorSnapshot.stripCount` round-trips through the controller
      snapshot's JSON test (grep gate on `stripCount` in the controller
      tests).
- [x] `npm run build`, `npm run check:strict` and `npm run test:run` pass.

### Manual / on-hardware (verified by a human before merge)

- [ ] On a real GNOME Shell session with `npm run dev`, with three
      windows overlapping, opening the overlay and resting the cursor on
      the overlap shows a strip of three thumbnails along the bottom,
      frontmost on the left, each with its app icon on its top edge, the
      leftmost highlighted and its title in a pill under the strip; each
      scroll-down notch moves the highlight one thumbnail to the right and
      wraps, in step with the large clone that comes forward; scroll-up
      reverses it.
- [ ] Moving the cursor to a spot with no window leaves the strip as it
      is; moving it onto a single window shows that window alone; moving
      it to another overlap shows that group's thumbnails; carrying the
      cursor from the overlap down onto the strip keeps it up, and
      scrolling there walks the thumbnails.
- [ ] Clicking a thumbnail raises that window and closes the overlay;
      Esc still closes with the desktop unchanged and the strip gone; the
      top bar and the dock remain usable while the strip is shown.
