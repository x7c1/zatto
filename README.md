# zatto

A GNOME Shell extension that lifts a window sitting one or two layers behind the active one, without moving anything on screen.

Switching to a window that is already visible on screen, just partially hidden behind the active one, should not require a full re-arranged overview. You already know where the window is. zatto keeps every window at its own position and lets you bring the one you want to the front.

## Status

Proof of concept. Entering the bottom-left hot corner opens an overlay: the real windows are hidden and their clones slide from the windows' positions into an oblique, translucent depth view of the stacking order, with deeper windows offset towards the top-left. The depth view is drawn in the work area, between the top bar and the dock, which stay visible and usable. Clicking a clone raises its window, and Esc, re-entering the corner or clicking on nothing (empty desktop in the depth view, or the top bar or the dock outside it) closes the overlay; closing slides the clones back onto the windows before the real windows reappear. With the overlay open, the scroll wheel (or Tab and Shift+Tab) moves a focus through the windows that overlap under the cursor, one window per notch: the focused window turns opaque and comes to the front of the picture while nothing moves, and a click or Enter raises it. Resting the cursor on a window shows it, and the windows overlapping it there, as a row of thumbnails along the bottom, frontmost first, with the focused one highlighted and titled; the strip follows the cursor from window to window and goes away over empty desktop, and clicking a thumbnail raises that window.

## License

GPL-3.0 — see [LICENSE](LICENSE).
