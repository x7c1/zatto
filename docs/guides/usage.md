# Usage

How to open zatto's depth view, pick a window in it, and choose the corners
that open it.

## Opening and closing the depth view

Move the pointer into a hot corner of the primary monitor to open the depth
view. The bottom-left and bottom-right corners do so by default; which
corners do is set in the [preferences](#choosing-the-corners).

When it opens, the real windows are hidden and their clones slide from the
windows' positions into an oblique, translucent depth view of the stacking
order, with deeper windows offset towards the top-left.

Any of these closes it:

- Esc;
- re-entering a hot corner;
- clicking on nothing: empty desktop in the depth view, or the top bar or a
  fixed dock outside it.

Closing slides the clones back onto the windows before the real windows
reappear.

## The top bar and the dock

The depth view is drawn in the work area:

- With a fixed dock, it sits between the top bar and the dock, which stay
  visible and usable.
- With an auto-hide (intellihide) dock, which reserves no space, it also
  covers the dock's area, and the dock stays hidden while the depth view is
  open.

## Picking a window

- **Click** a clone to raise its window.
- **Cycle** with the scroll wheel, or Tab and Shift+Tab. The focus moves
  through the windows that overlap under the cursor, one window per notch.
  The focused window turns less translucent and comes to the front of the
  picture while nothing moves. A click or Enter raises it.

## The thumbnail strip

Resting the cursor on a window shows it, and the windows overlapping it
there, as a row of thumbnails along the bottom, frontmost first, with the
focused one highlighted and titled.

- The strip follows the cursor from window to window and goes away over
  empty desktop.
- Pointing at a thumbnail focuses its window, and clicking it raises that
  window.

## Dialogs

A window's dialogs (such as a "Save changes?" prompt or a file chooser) are
drawn with that window's clone, at their real offset from it, and move and
fade with it. They are part of their parent, not windows of their own: they
take no place in the depth order, are not a cycle step or a thumbnail of
their own, and clicking one acts like clicking its parent. Raising a window
that has a modal dialog activates the dialog, so the keyboard goes where it
is expected.

## Choosing the corners

Open the preferences from the Extensions app, or with:

```bash
gnome-extensions prefs zatto@x7c1.github.io
```

The page shows a picture of the display with a toggle at each of its four
corners. A text below the picture says which corners open the depth view.

GNOME Shell's own Activities hot corner also lives in the top-left corner.
If you switch zatto's top-left corner on while GNOME's is on too, the text
says so; you can turn GNOME's off in Settings › Multitasking › Hot Corner.

A change applies at once, without logging out.
