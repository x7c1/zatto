/**
 * Pure prune logic for stale `<base>-reload-<timestamp>` UUIDs in GNOME
 * Shell's enabled-extensions / disabled-extensions GSettings arrays.
 *
 * Background: `Reloader.reload()` enables a fresh `<base>-reload-<ts>` UUID
 * and disables the previous one on every `npm run dev` iteration. GNOME
 * Shell never garbage-collects entries in the GSettings arrays, so disabled
 * reload UUIDs pile up indefinitely. This helper, invoked at the tail of
 * `reload()` after the new UUID has been enabled, deletes every accumulated
 * reload UUID for the given base except the one currently running, leaving
 * the canonical UUID and unrelated extensions untouched.
 */

import type { ShellExtensionSettingsPort } from './ports.js';

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pruneList(list: string[], pattern: RegExp, preserveUuid: string): string[] | null {
  const filtered = list.filter((uuid) => !pattern.test(uuid) || uuid === preserveUuid);
  return filtered.length === list.length ? null : filtered;
}

/**
 * Remove every `<baseUuid>-reload-<digits>` entry from both GSettings keys
 * except `currentReloadUuid`. The canonical `baseUuid` (which lacks the
 * `-reload-` suffix) and unrelated UUIDs are left in place.
 *
 * Writes back to GSettings only when the list actually changes, so a
 * steady-state reload does not generate spurious DConf traffic.
 */
export function pruneStaleReloadUuids(
  port: ShellExtensionSettingsPort,
  baseUuid: string,
  currentReloadUuid: string
): void {
  const pattern = new RegExp(`^${escapeRegExp(baseUuid)}-reload-\\d+$`);

  const enabled = port.getEnabled();
  const prunedEnabled = pruneList(enabled, pattern, currentReloadUuid);
  if (prunedEnabled !== null) {
    port.setEnabled(prunedEnabled);
  }

  const disabled = port.getDisabled();
  const prunedDisabled = pruneList(disabled, pattern, currentReloadUuid);
  if (prunedDisabled !== null) {
    port.setDisabled(prunedDisabled);
  }
}
