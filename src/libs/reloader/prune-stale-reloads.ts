/**
 * Pure prune logic for stale `<base>-reload-<timestamp>` UUIDs in GNOME
 * Shell's enabled-extensions / disabled-extensions GSettings arrays.
 *
 * Background: every `npm run dev` enables a fresh `<base>-reload-<ts>` UUID
 * and unloads the previous one. Unloading never writes GSettings, so each
 * previous UUID stays in `enabled-extensions` and they pile up there.
 * `disabled-extensions` gets no new entries; it is pruned too only to clear
 * what older reloaders, which disabled instead of unloading, left behind.
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

/**
 * Remove every `<baseUuid>-reload-<digits>` entry from both GSettings keys
 * except `preserveUuid`. The canonical `baseUuid` (which lacks the
 * `-reload-` suffix) and unrelated UUIDs are left in place.
 *
 * Writes back to GSettings only when the list actually changes, so a
 * steady-state reload does not generate spurious DConf traffic.
 */
export function pruneStaleReloadUuids(
  port: ShellExtensionSettingsPort,
  baseUuid: string,
  preserveUuid: string
): void {
  const pattern = reloadPattern(baseUuid);

  const enabled = port.getEnabled();
  const prunedEnabled = pruneList(enabled, pattern, preserveUuid);
  if (prunedEnabled !== null) {
    port.setEnabled(prunedEnabled);
  }

  const disabled = port.getDisabled();
  const prunedDisabled = pruneList(disabled, pattern, preserveUuid);
  if (prunedDisabled !== null) {
    port.setDisabled(prunedDisabled);
  }
}
