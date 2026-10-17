/**
 * GLib main-loop implementation of {@link TimeoutPort}.
 */

import GLib from 'gi://GLib';
import type { TimeoutPort } from '../../ui/overlay/ports.js';

export class GLibTimeout implements TimeoutPort {
  schedule(ms: number, callback: () => void): () => void {
    let sourceId: number | null = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      sourceId = null;
      callback();
      return GLib.SOURCE_REMOVE;
    });
    return () => {
      if (sourceId !== null) {
        GLib.source_remove(sourceId);
        sourceId = null;
      }
    };
  }
}
