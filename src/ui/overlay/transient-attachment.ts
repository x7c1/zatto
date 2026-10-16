/**
 * Which windows the depth view draws, and which of them are drawn as part
 * of another window.
 *
 * A window that belongs to another one — a dialog, a modal dialog or a
 * utility window whose transient parent is that window, or a normal window
 * with a transient parent — is not a window of its own in the depth view.
 * It is attached to its root parent (the end of its transient-parent
 * chain): drawn with the parent's clone, at its real offset from it, and
 * it takes no depth slot, so the depth layout is computed over the root
 * windows only. This is what the Activities Overview does in gnome-shell's
 * `js/ui/windowPreview.js`, which walks `foreach_transient` and adds each
 * attached dialog to the parent's `WindowPreview`.
 *
 * Eligibility:
 *
 *   - A root is a `normal` window with no transient parent, or whose
 *     transient parent is not among the windows described (Mutter can
 *     report a parent that has no window actor); it is drawn if it is not
 *     minimized and is on the current workspace.
 *   - A transient is attached to a drawn window if its type is one of
 *     {@link ATTACHABLE_TYPES}, its transient parent is that window, it is
 *     not minimized and it is on the current workspace. Transients of an
 *     attached transient are attached to the same root, recursively.
 *   - Anything else is not drawn: a transient whose parent is not drawn
 *     (minimized, on another workspace, or itself not drawn), and every
 *     other window type (menus, tooltips, docks and so on).
 *
 * Activation: activating a root that has a modal dialog among its
 * attached transients activates that dialog instead (the topmost one if
 * there are several), so the user ends up in the window that holds the
 * keyboard.
 *
 * No `gi://` imports: this module is unit-tested under vitest.
 */

/** The window types the depth view tells apart; every other type is `other`. */
export type WindowKind = 'normal' | 'dialog' | 'modal-dialog' | 'utility' | 'other';

/** The window types that are attached to their transient parent. */
const ATTACHABLE_TYPES: ReadonlySet<WindowKind> = new Set([
  'normal',
  'dialog',
  'modal-dialog',
  'utility',
]);

/** A plain description of one window, independent of Mutter. */
export interface WindowDescription {
  /** Unique among the windows described. */
  readonly id: number;
  readonly type: WindowKind;
  /** The id of the window this one is transient for, or `null`. */
  readonly transientFor: number | null;
  readonly minimized: boolean;
  /** Whether the window is located on the current workspace. */
  readonly onCurrentWorkspace: boolean;
}

/** A drawn window and the transients drawn with it. */
export interface AttachedGroup {
  /** Index into the input of the root window; it takes the depth slot. */
  readonly parent: number;
  /**
   * Indices into the input of the transients drawn with the root, in
   * input (bottom-to-top) order so they paint the way they are stacked.
   */
  readonly transients: readonly number[];
  /** Index into the input of the window to activate when the group is picked. */
  readonly activate: number;
}

/**
 * Group `windows` (in bottom-to-top stacking order) into the windows the
 * depth view draws, each with its attached transients. The groups are in
 * the order of their roots in the input, so the depth layout computed over
 * the roots keeps the stacking order. A window appears in at most one
 * group, and windows that are not drawn appear in none.
 */
export function attachTransients(windows: readonly WindowDescription[]): AttachedGroup[] {
  const indexById = new Map<number, number>();
  windows.forEach((win, index) => {
    indexById.set(win.id, index);
  });

  const isVisible = (win: WindowDescription) => !win.minimized && win.onCurrentWorkspace;

  // Children by transient parent, for the top-down walk from each root.
  const children = new Map<number, number[]>();
  windows.forEach((win, index) => {
    if (win.transientFor === null || !indexById.has(win.transientFor)) {
      return;
    }
    const siblings = children.get(win.transientFor) ?? [];
    siblings.push(index);
    children.set(win.transientFor, siblings);
  });

  // The walk starts only at roots, which have no described transient
  // parent, and every window has one parent at most: each window is
  // reached at most once, and a cycle in the transient relation is never
  // reached at all.
  const groups: AttachedGroup[] = [];

  windows.forEach((win, index) => {
    const isRoot =
      win.type === 'normal' && (win.transientFor === null || !indexById.has(win.transientFor));
    if (!isRoot || !isVisible(win)) {
      return;
    }

    const transients: number[] = [];
    const pending = [...(children.get(win.id) ?? [])];
    while (pending.length > 0) {
      const next = pending.pop() as number;
      const candidate = windows[next];
      if (!ATTACHABLE_TYPES.has(candidate.type) || !isVisible(candidate)) {
        continue;
      }
      transients.push(next);
      pending.push(...(children.get(candidate.id) ?? []));
    }
    transients.sort((a, b) => a - b);

    const modal = transients.filter((t) => windows[t].type === 'modal-dialog');
    groups.push({ parent: index, transients, activate: modal.at(-1) ?? index });
  });

  return groups;
}
