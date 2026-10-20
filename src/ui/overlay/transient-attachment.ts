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
 *   - A root is a window whose type is one of {@link DRAWN_TYPES} and that
 *     has no transient parent, or whose transient parent is not among the
 *     windows described (Mutter can report a parent that has no window
 *     actor); it is drawn if it is not minimized and is on the current
 *     workspace. A parentless dialog, modal dialog or utility window (an
 *     extension's preferences window, for one) is a root like a `normal`
 *     window, as the Activities Overview lists it as a window of its own.
 *   - A transient is attached to a drawn window if its type is one of
 *     {@link DRAWN_TYPES}, its transient parent is that window, it is
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

/**
 * The window types that are drawn: as a root when they have no described
 * transient parent, attached to their parent otherwise.
 */
const DRAWN_TYPES: ReadonlySet<WindowKind> = new Set([
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
      DRAWN_TYPES.has(win.type) && (win.transientFor === null || !indexById.has(win.transientFor));
    if (!isRoot || !isVisible(win)) {
      return;
    }

    const transients: number[] = [];
    const pending = [...(children.get(win.id) ?? [])];
    while (pending.length > 0) {
      const next = pending.pop() as number;
      const candidate = windows[next];
      if (!DRAWN_TYPES.has(candidate.type) || !isVisible(candidate)) {
        continue;
      }
      transients.push(next);
      pending.push(...(children.get(candidate.id) ?? []));
    }
    transients.sort((a, b) => a - b);

    const modal = topmostModal(transients.map((t) => windows[t]));
    groups.push({
      parent: index,
      transients,
      activate: modal === null ? index : transients[modal],
    });
  });

  return groups;
}

/**
 * The window to activate for a drawn window whose attached transients are
 * `transients` (bottom to top): the topmost modal dialog among them, as a
 * position in `transients`, or `null` for the window itself. The rule
 * {@link attachTransients} applies at mount, for a group whose transients
 * change while the depth view is open.
 */
export function topmostModal(transients: readonly WindowDescription[]): number | null {
  for (let i = transients.length - 1; i >= 0; i--) {
    if (transients[i].type === 'modal-dialog') {
      return i;
    }
  }
  return null;
}

/**
 * The root a window created while the depth view is open is drawn with:
 * the id of the drawn root window `added` is attached to, by the same rule
 * {@link attachTransients} applies at mount, or `null` when it is not
 * attached to any (it is not a transient of a drawn window, it is not of a
 * drawn type, or it is not visible). `drawn` describes the windows drawn
 * now, roots and attached transients, bottom to top; `added` is stacked
 * above them. A window that would be a root of its own is not added: the
 * depth view keeps the windows it opened with.
 */
export function attachLateWindow(
  drawn: readonly WindowDescription[],
  added: WindowDescription
): number | null {
  const windows = [...drawn, added];
  const addedIndex = windows.length - 1;
  const group = attachTransients(windows).find(({ transients }) => transients.includes(addedIndex));
  return group === undefined ? null : windows[group.parent].id;
}

/** The ids of one drawn window and of the transients drawn with it. */
export interface DrawnGroupIds {
  readonly root: number;
  readonly transients: readonly number[];
}

/**
 * What to drop from the depth view when the window `id` goes: the whole
 * group at `group` (its root went, and its transients go with it), the
 * transient at position `transient` of that group, or nothing (`null`)
 * when the window is not drawn.
 */
export type Removal =
  | { readonly kind: 'group'; readonly group: number }
  | { readonly kind: 'transient'; readonly group: number; readonly transient: number }
  | null;

/** See {@link Removal}. `groups` are the drawn groups in mount order. */
export function removalOf(groups: readonly DrawnGroupIds[], id: number): Removal {
  for (let group = 0; group < groups.length; group++) {
    if (groups[group].root === id) {
      return { kind: 'group', group };
    }
    const transient = groups[group].transients.indexOf(id);
    if (transient !== -1) {
      return { kind: 'transient', group, transient };
    }
  }
  return null;
}

/**
 * Why a window is not drawn:
 *
 *   - `unsupported-type`: its type is `other` (menus, tooltips, docks…).
 *   - `minimized`, `other-workspace`: it is not visible.
 *   - `parent-not-drawn`: it has a described transient parent that is not
 *     drawn (or the transient relation is a cycle that no root reaches).
 *   - `dropped`: the rules above would draw it, but the caller left it out
 *     of the drawn groups (the mirror drops a window whose rect is empty).
 */
export type NotDrawnReason =
  | 'unsupported-type'
  | 'minimized'
  | 'other-workspace'
  | 'parent-not-drawn'
  | 'dropped';

/** What became of one window: drawn as a root, attached to one, or not drawn. */
export type AttachmentOutcome =
  | { readonly outcome: 'root' }
  | {
      readonly outcome: 'attached';
      /** The id of the root window it is drawn with. */
      readonly root: number;
    }
  | { readonly outcome: 'not-drawn'; readonly reason: NotDrawnReason };

/**
 * The outcome of every window in `windows` (same order) given the groups
 * that were actually drawn: normally `attachTransients(windows)`, possibly
 * with some groups or transients left out by the caller. For diagnostics:
 * it says why a window is missing from the depth view.
 */
export function explainAttachment(
  windows: readonly WindowDescription[],
  drawn: readonly AttachedGroup[]
): AttachmentOutcome[] {
  const outcomes = new Map<number, AttachmentOutcome>();
  const drawnIds = new Set<number>();
  for (const group of drawn) {
    const root = windows[group.parent].id;
    outcomes.set(group.parent, { outcome: 'root' });
    drawnIds.add(root);
    for (const t of group.transients) {
      outcomes.set(t, { outcome: 'attached', root });
      drawnIds.add(windows[t].id);
    }
  }
  const describedIds = new Set(windows.map((win) => win.id));

  return windows.map((win, index): AttachmentOutcome => {
    const known = outcomes.get(index);
    if (known !== undefined) {
      return known;
    }
    const notDrawn = (reason: NotDrawnReason) => ({ outcome: 'not-drawn' as const, reason });
    if (!DRAWN_TYPES.has(win.type)) {
      return notDrawn('unsupported-type');
    }
    if (win.minimized) {
      return notDrawn('minimized');
    }
    if (!win.onCurrentWorkspace) {
      return notDrawn('other-workspace');
    }
    if (
      win.transientFor !== null &&
      describedIds.has(win.transientFor) &&
      !drawnIds.has(win.transientFor)
    ) {
      return notDrawn('parent-not-drawn');
    }
    return notDrawn('dropped');
  });
}
