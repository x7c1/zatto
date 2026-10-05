/**
 * Pure prune logic for stale `<base>-reload-<timestamp>` UUIDs in GNOME
 * Shell's enabled-extensions / disabled-extensions GSettings arrays.
 *
 * Background: `Reloader.reload()` enables a fresh `<base>-reload-<ts>` UUID
 * and unloads the previous one on every `npm run dev` iteration. Unloading
 * never writes GSettings, so the previous UUID stays in
 * `enabled-extensions` and stale reload UUIDs pile up there indefinitely.
 * `disabled-extensions` collects no new entries, but is pruned as well to
 * clear out what older reloaders (which disabled instead of unloading) left
 * there. This helper, invoked by `reload()` just before the new UUID is
 * enabled, deletes every accumulated reload UUID for the given base except
 * the new one, leaving the canonical UUID and unrelated extensions
 * untouched. The canonical UUID is what makes GNOME Shell start the
 * extension on the next login: the reload copies live in /tmp, which is
 * never scanned at startup.
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
/**
 * Whether `uuid` is a reload copy of the extension `baseUuid`, i.e.
 * exactly `<baseUuid>-reload-<digits>`. Other extensions may use the same
 * reload scheme, so matching on `-reload-` alone would also catch their
 * copies.
 */
export function isReloadUuidOf(baseUuid: string, uuid: string): boolean {
  return reloadPattern(baseUuid).test(uuid);
}

function reloadPattern(baseUuid: string): RegExp {
  return new RegExp(`^${escapeRegExp(baseUuid)}-reload-\\d+$`);
}

export function pruneStaleReloadUuids(
  port: ShellExtensionSettingsPort,
  baseUuid: string,
  currentReloadUuid: string
): void {
  const pattern = reloadPattern(baseUuid);

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
