/**
 * Pure decision for when the cycle strip changes as the pointer moves:
 * at once while no strip is shown, and after a grace period while one is,
 * so the pointer can cross other windows or gaps on its way to the strip.
 * The behaviour is specified on `WindowMirrorPort.hoverAt`; this unit
 * holds the pending change and its timer.
 *
 * No `gi://` imports: this module is unit-tested under vitest, with the
 * timer injected as a {@link TimeoutPort}.
 */

import { sameMembers } from './depth-cycle.js';
import type { TimeoutPort } from './ports.js';

export interface StripHoverGraceOptions {
  /** How long the pointer must stay over a new target before the strip changes, in ms. */
  readonly graceMs: number;
  readonly timeout: TimeoutPort;
  /** The group the strip shows ({@link windowsUnder} order), or `null` while it is hidden. */
  readonly shown: () => readonly number[] | null;
  /** Show `group` in the strip, or hide the strip for `null`. */
  readonly apply: (group: readonly number[] | null) => void;
}

interface Pending {
  readonly group: readonly number[];
  readonly cancel: () => void;
}

export class StripHoverGrace {
  private pending: Pending | null = null;

  constructor(private readonly options: StripHoverGraceOptions) {}

  /**
   * The pointer is over `group` ({@link windowsUnder} order), which is
   * empty over empty desktop.
   */
  pointerOver(group: readonly number[]): void {
    const shown = this.options.shown();
    if (shown === null) {
      this.cancel();
      if (group.length > 0) {
        this.options.apply(group);
      }
      return;
    }
    if (sameMembers(shown, group)) {
      // Back over what the strip shows before the grace period ended.
      this.cancel();
      return;
    }
    if (this.pending !== null && sameMembers(this.pending.group, group)) {
      // Still over the same target: let its grace period run on.
      return;
    }
    this.cancel();
    const target = group.length > 0 ? group : null;
    const cancel = this.options.timeout.schedule(this.options.graceMs, () => {
      this.pending = null;
      this.options.apply(target);
    });
    this.pending = { group, cancel };
  }

  /** The pointer reached the strip: keep what it shows. */
  pointerOnStrip(): void {
    this.cancel();
  }

  /** Drop any pending change. Idempotent; called when the overlay closes or unmounts. */
  cancel(): void {
    const pending = this.pending;
    this.pending = null;
    pending?.cancel();
  }
}
