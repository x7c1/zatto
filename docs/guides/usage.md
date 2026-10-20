# Usage

How to open zatto's depth view, pick a window in it, set up the corners and
the top bar indicator that open it, and activate a license.

## Opening and closing the depth view

Move the pointer into a hot corner of the primary monitor to open the depth
view. The bottom-left and bottom-right corners do so by default; which
corners do is set in the [preferences](#preferences). The
[top bar indicator](#the-top-bar-indicator) opens it too. While zatto is
[locked](#when-zatto-is-locked), it does not open.

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

## The top bar indicator

zatto adds an icon of two stacked windows to the top bar. Its menu has:

- **Open Depth View** — opens the depth view, as a hot corner does; it
  closes in the same ways.
- **Preferences…** — opens the [preferences](#preferences).
- below a separator, the [license](#license) status, for example
  "License: Trial — 23 days of use left" (shown only, not a button).

The icon can be hidden in the preferences.

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
  empty desktop. Once it is up, it changes only after the cursor rests for
  a moment, so it does not flicker while the cursor sweeps across windows.
- Pointing at a thumbnail focuses its window, and clicking it raises that
  window.
- The settings button at the right end of the title row closes the depth
  view without raising any window, as Esc does, and opens the
  [preferences](#preferences).

## Dialogs

A window's dialogs (such as a "Save changes?" prompt or a file chooser) are
drawn with that window's clone, at their real offset from it, and move and
fade with it. They are part of their parent, not windows of their own: they
take no place in the depth order, are not a cycle step or a thumbnail of
their own, and clicking one acts like clicking its parent. Raising a window
that has a modal dialog activates the dialog, so the keyboard goes where it
is expected.

## License

zatto starts with a trial and keeps running with a license key.

- **Trial** — The trial lasts 30 days of use. A day of use is a day on
  which you open the depth view (from a hot corner or the top bar menu); it
  counts once, the first time that day. A notification warns you when 3
  days and when 1 day are left; its **Open Preferences** button opens the
  **License** page.
- **License key** — Activate a license key on the **License** page of the
  [preferences](#preferences). The page shows the license status and
  checks the key with the license server.
- **Offline** — An activated license keeps working offline for 7 days from
  the last time the device was online.
- **No answer, no lock** — Only an answer from the license server can
  expire or invalidate a license. When it does not answer (it is down,
  unreachable, or retired), zatto keeps the status it had. Once the trial
  has ended, zatto asks the license server whether it is still there the
  next time it starts (for example when you log in) while the device is
  online, and unlocks if the server no longer answers.

### When zatto is locked

zatto is locked when the trial has ended, when the license has expired or
is no longer valid, or when a device with a license has been offline for
more than 7 days. Opening the depth view then does nothing but show a
notification that says why. Unless the cause is being offline (reconnect
to the internet instead), its **Open Preferences** button opens the
preferences on the **License** page, where a license key can be activated.
Activating one unlocks zatto at once, without logging out.

## Preferences

Open the preferences from the top bar indicator's menu, from the settings
button on the [thumbnail strip](#the-thumbnail-strip), from the Extensions
app, or with:

```bash
gnome-extensions prefs zatto@x7c1.github.io
```

A change applies at once, without logging out. The window has two pages:
**General**, with the settings below, and **License**, with the
[license](#license) status and the license key.

### Choosing the corners

The page shows a picture of the display with a toggle at each of its four
corners. A text below the picture says which corners open the depth view.

GNOME Shell's own Activities hot corner also lives in the top-left corner.
If you switch zatto's top-left corner on while GNOME's is on too, the text
says so; you can turn GNOME's off in Settings › Multitasking › Hot Corner.

### Showing the top bar indicator

The **Show top bar indicator** switch, under **Top bar**, shows or hides the
[top bar indicator](#the-top-bar-indicator). It is on by default. With it
off, the preferences are still reachable from the thumbnail strip, the
Extensions app and the command above.
