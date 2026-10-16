import { describe, expect, it } from 'vitest';
import { computeDepthLayout, DEPTH_VIEW_TUNING, type Rect } from './depth-layout.js';
import {
  type AttachedGroup,
  attachTransients,
  type WindowDescription,
  type WindowKind,
} from './transient-attachment.js';

function win(
  id: number,
  type: WindowKind = 'normal',
  options: Partial<Omit<WindowDescription, 'id' | 'type'>> = {}
): WindowDescription {
  return {
    id,
    type,
    transientFor: null,
    minimized: false,
    onCurrentWorkspace: true,
    ...options,
  };
}

/** The groups with input indices replaced by window ids, for readable expectations. */
function byId(windows: readonly WindowDescription[], groups: readonly AttachedGroup[]) {
  return groups.map(({ parent, transients, activate }) => ({
    parent: windows[parent].id,
    transients: transients.map((t) => windows[t].id),
    activate: windows[activate].id,
  }));
}

describe('attachTransients', () => {
  it('keeps windows without transients as groups of their own, in stacking order', () => {
    const windows = [win(1), win(2)];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [], activate: 1 },
      { parent: 2, transients: [], activate: 2 },
    ]);
  });

  it('attaches a dialog to its parent', () => {
    const windows = [win(1), win(2), win(3, 'dialog', { transientFor: 1 })];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [3], activate: 1 },
      { parent: 2, transients: [], activate: 2 },
    ]);
  });

  it('attaches a modal dialog and activates it in place of its parent', () => {
    const windows = [win(1), win(2, 'modal-dialog', { transientFor: 1 })];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [2], activate: 2 },
    ]);
  });

  it('attaches a utility window to its parent', () => {
    const windows = [win(1), win(2, 'utility', { transientFor: 1 })];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [2], activate: 1 },
    ]);
  });

  it('attaches a dialog of a dialog to the root parent', () => {
    const windows = [
      win(1),
      win(2, 'dialog', { transientFor: 1 }),
      win(3, 'modal-dialog', { transientFor: 2 }),
    ];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [2, 3], activate: 3 },
    ]);
  });

  it('activates the topmost of several modal dialogs', () => {
    const windows = [
      win(1),
      win(2, 'modal-dialog', { transientFor: 1 }),
      win(3, 'modal-dialog', { transientFor: 1 }),
    ];
    expect(byId(windows, attachTransients(windows))[0].activate).toBe(3);
  });

  it('keeps the transients in stacking order whatever order they were found in', () => {
    const windows = [
      win(1),
      win(4, 'dialog', { transientFor: 1 }),
      win(2, 'dialog', { transientFor: 4 }),
      win(3, 'dialog', { transientFor: 1 }),
    ];
    expect(byId(windows, attachTransients(windows))[0].transients).toEqual([4, 2, 3]);
  });

  it('does not draw a minimized dialog', () => {
    const windows = [win(1), win(2, 'dialog', { transientFor: 1, minimized: true })];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [], activate: 1 },
    ]);
  });

  it('does not draw the transients of a dialog that is not drawn', () => {
    const windows = [
      win(1),
      win(2, 'dialog', { transientFor: 1, minimized: true }),
      win(3, 'dialog', { transientFor: 2 }),
    ];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [], activate: 1 },
    ]);
  });

  it('does not draw a dialog whose parent is minimized', () => {
    const windows = [
      win(1, 'normal', { minimized: true }),
      win(2),
      win(3, 'dialog', { transientFor: 1 }),
    ];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 2, transients: [], activate: 2 },
    ]);
  });

  it('does not draw a dialog whose parent is on another workspace', () => {
    const windows = [
      win(1, 'normal', { onCurrentWorkspace: false }),
      win(2, 'dialog', { transientFor: 1 }),
    ];
    expect(attachTransients(windows)).toEqual([]);
  });

  it('does not draw a dialog on another workspace', () => {
    const windows = [win(1), win(2, 'dialog', { transientFor: 1, onCurrentWorkspace: false })];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [], activate: 1 },
    ]);
  });

  it('attaches a normal window that has a transient parent instead of giving it a slot', () => {
    const windows = [win(1), win(2, 'normal', { transientFor: 1 }), win(3)];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [2], activate: 1 },
      { parent: 3, transients: [], activate: 3 },
    ]);
  });

  it('keeps a normal window whose transient parent is not described as a root', () => {
    const windows = [win(1, 'normal', { transientFor: 99 })];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [], activate: 1 },
    ]);
  });

  it('does not draw a dialog without a transient parent, nor other window types', () => {
    const windows = [win(1), win(2, 'dialog'), win(3, 'other', { transientFor: 1 })];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [], activate: 1 },
    ]);
  });

  it('does not loop on a cycle in the transient relation', () => {
    const windows = [
      win(1),
      win(2, 'dialog', { transientFor: 3 }),
      win(3, 'dialog', { transientFor: 2 }),
    ];
    expect(byId(windows, attachTransients(windows))).toEqual([
      { parent: 1, transients: [], activate: 1 },
    ]);
  });
});

describe('attached transients and the depth layout', () => {
  it('leaves the layout of the parents as it is without their dialogs', () => {
    const area = { width: 1920, height: 1080 };
    const parents: { desc: WindowDescription; frame: Rect }[] = [
      { desc: win(1), frame: { x: 0, y: 0, width: 1920, height: 1080 } },
      { desc: win(2), frame: { x: 200, y: 100, width: 1200, height: 800 } },
      { desc: win(3), frame: { x: 600, y: 300, width: 800, height: 600 } },
    ];
    // Dialogs stacked between and above the parents, as Mutter stacks a
    // dialog right above its parent, one of them hanging off the parents'
    // bounding box so it would widen the fit if it took part in it.
    const dialogs: { desc: WindowDescription; frame: Rect }[] = [
      {
        desc: win(4, 'modal-dialog', { transientFor: 1 }),
        frame: { x: -300, y: 900, width: 400, height: 400 },
      },
      {
        desc: win(5, 'dialog', { transientFor: 2 }),
        frame: { x: 500, y: 300, width: 400, height: 200 },
      },
      {
        desc: win(6, 'dialog', { transientFor: 5 }),
        frame: { x: 550, y: 350, width: 300, height: 150 },
      },
    ];
    const withDialogs = [parents[0], dialogs[0], parents[1], dialogs[1], dialogs[2], parents[2]];

    const layoutOf = (windows: readonly { desc: WindowDescription; frame: Rect }[]) =>
      computeDepthLayout(
        attachTransients(windows.map(({ desc }) => desc)).map(
          ({ parent }) => windows[parent].frame
        ),
        area,
        DEPTH_VIEW_TUNING
      );

    expect(
      attachTransients(withDialogs.map(({ desc }) => desc)).map((g) => g.transients.length)
    ).toEqual([1, 2, 0]);
    expect(layoutOf(withDialogs)).toEqual(layoutOf(parents));
  });
});
