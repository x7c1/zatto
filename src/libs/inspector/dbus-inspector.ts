/// <reference path="../../build-mode.d.ts" />

/**
 * D-Bus Inspector Interface
 *
 * Read-only sibling of `DBusReloader`: exposes `GetState` (live controller
 * snapshot) and `GetBuildInfo` (commit SHA + build timestamp + UUID) for
 * manual debugging and, eventually, nested-shell e2e assertions. See the
 * reloader for the broader D-Bus registration pattern; this class follows
 * the same shape but stays read-only.
 *
 * Usage from command line:
 *   gdbus call --session \
 *     --dest org.gnome.Shell \
 *     --object-path /io/github/x7c1/Zatto/Inspect \
 *     --method io.github.x7c1.Zatto.Inspect.GetState
 *
 *   gdbus call --session \
 *     --dest org.gnome.Shell \
 *     --object-path /io/github/x7c1/Zatto/Inspect \
 *     --method io.github.x7c1.Zatto.Inspect.GetBuildInfo
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DBUS_INTERFACE_NAME = 'io.github.x7c1.Zatto.Inspect';
const DBUS_OBJECT_PATH = '/io/github/x7c1/Zatto/Inspect';

const DBUS_INTERFACE_XML = `
<node>
  <interface name="${DBUS_INTERFACE_NAME}">
    <method name="GetState">
      <arg type="s" direction="out" name="snapshot"/>
    </method>
    <method name="GetBuildInfo">
      <arg type="s" direction="out" name="buildInfo"/>
    </method>
  </interface>
</node>
`;

/**
 * Anything that can hand back a JSON-serializable state blob. Kept as a
 * one-method interface so the inspector is not coupled to OverlayController
 * directly — future state contributors (e.g. a window-zone picker) can be
 * composed in via a wrapper that merges multiple snapshots.
 */
export interface StateProvider {
  snapshot(): unknown;
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

export class DBusInspector {
  private dbusId: number | null = null;
  private readonly uuid: string;

  constructor(
    private readonly provider: StateProvider,
    uuid: string
  ) {
    this.uuid = uuid;
  }

  /**
   * Register the D-Bus interface.
   *
   * Returns `true` on success, `false` when registration fails (e.g.
   * another extension instance already owns the object path). Callers
   * should null out their reference on `false` so the matching `disable()`
   * stays a no-op.
   */
  enable(): boolean {
    try {
      console.log('[DBusInspector] Starting D-Bus registration...');
      const connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
      const nodeInfo = Gio.DBusNodeInfo.new_for_xml(DBUS_INTERFACE_XML);
      const interfaceInfo = nodeInfo.lookup_interface(DBUS_INTERFACE_NAME);

      if (!interfaceInfo) {
        throw new Error('Failed to lookup D-Bus interface info');
      }

      this.dbusId = connection.register_object(
        DBUS_OBJECT_PATH,
        interfaceInfo,
        (
          _connection: any,
          _sender: string,
          _object_path: string,
          _interface_name: string,
          method_name: string,
          _parameters: any,
          invocation: any
        ) => {
          if (method_name === 'GetState') {
            this.handleGetState(invocation);
          } else if (method_name === 'GetBuildInfo') {
            this.handleGetBuildInfo(invocation);
          }
        },
        null,
        null
      );

      console.log(
        `[DBusInspector] D-Bus interface registered at ${DBUS_OBJECT_PATH} with ID: ${this.dbusId}`
      );
      return true;
    } catch (e: unknown) {
      console.error(`[DBusInspector] Failed to register D-Bus interface: ${getErrorMessage(e)}`);
      console.error(
        `[DBusInspector] Another zatto instance already owns ${DBUS_OBJECT_PATH}. ` +
          'The inspector is disabled for THIS instance. ' +
          'On Wayland, log out and back in to recover.'
      );
      this.dbusId = null;
      return false;
    }
  }

  disable(): void {
    if (this.dbusId !== null) {
      try {
        const connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
        connection.unregister_object(this.dbusId);
        this.dbusId = null;
        console.log('[DBusInspector] D-Bus interface unregistered');
      } catch (e: unknown) {
        console.log(`[DBusInspector] Failed to unregister: ${getErrorMessage(e)}`);
      }
    }
  }

  private handleGetState(invocation: Gio.DBusMethodInvocation): void {
    try {
      const snapshot = this.provider.snapshot();
      const json = JSON.stringify(snapshot);
      invocation.return_value(GLib.Variant.new('(s)', [json]));
    } catch (e: unknown) {
      console.log(`[DBusInspector] GetState failed: ${getErrorMessage(e)}`);
      invocation.return_error_literal(0, 1, `GetState failed: ${getErrorMessage(e)}`);
    }
  }

  /**
   * Return the build identifiers baked in at bundle time. Lets a manual
   * `gdbus` poke verify "is the running extension actually the bundle I
   * just built?" without grovelling through the journal. This is the
   * diagnostic that, had it existed, would have caught the wedged-shell
   * state during the step-5d verify cycle in a single command.
   */
  private handleGetBuildInfo(invocation: Gio.DBusMethodInvocation): void {
    try {
      const info = {
        commitSha: __BUILD_COMMIT_SHA__,
        buildTimestamp: __BUILD_TIMESTAMP__,
        uuid: this.uuid,
      };
      invocation.return_value(GLib.Variant.new('(s)', [JSON.stringify(info)]));
    } catch (e: unknown) {
      console.log(`[DBusInspector] GetBuildInfo failed: ${getErrorMessage(e)}`);
      invocation.return_error_literal(0, 1, `GetBuildInfo failed: ${getErrorMessage(e)}`);
    }
  }
}
