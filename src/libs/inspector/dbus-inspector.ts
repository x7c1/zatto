/**
 * D-Bus Inspector Interface
 *
 * Read-only sibling of `DBusReloader`: exposes a single `GetState` method that
 * returns a JSON-encoded snapshot of the running extension's controller state
 * for manual debugging and (eventually) nested-shell e2e assertions. See the
 * reloader for the broader D-Bus registration pattern; this class follows the
 * same shape but stays read-only.
 *
 * Usage from command line:
 *   gdbus call --session \
 *     --dest org.gnome.Shell \
 *     --object-path /io/github/x7c1/Zatto/Inspect \
 *     --method io.github.x7c1.Zatto.Inspect.GetState
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

  constructor(private readonly provider: StateProvider) {}

  enable(): void {
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
          }
        },
        null,
        null
      );

      console.log(
        `[DBusInspector] D-Bus interface registered at ${DBUS_OBJECT_PATH} with ID: ${this.dbusId}`
      );
    } catch (e: unknown) {
      console.log(`[DBusInspector] Failed to register D-Bus interface: ${getErrorMessage(e)}`);
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
}
