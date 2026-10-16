/**
 * The preferences page that chooses which corners of the primary monitor
 * open the depth view. The corners are picked on a picture of the display:
 * a toggle at each corner writes the whole `hot-corners` list back,
 * and the extension follows the change live.
 */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import type { HotCorner } from '../ui/overlay/hot-corner-geometry.js';
import {
  HOT_CORNERS_KEY,
  parseHotCorners,
  withHotCorner,
} from '../ui/overlay/hot-corner-setting.js';
import { CORNER_PLACEMENTS, type PictureEdge, pictureSize } from './corner-picture.js';
import { describeHotCorners } from './hot-corners-description.js';

/**
 * The Cairo calls the picture uses. GJS hands the draw function a Cairo
 * context whose GI typing has no methods, so they are declared here.
 */
interface CairoContext {
  setSourceRGBA(r: number, g: number, b: number, a: number): void;
  setLineWidth(width: number): void;
  rectangle(x: number, y: number, width: number, height: number): void;
  arc(xc: number, yc: number, radius: number, angle1: number, angle2: number): void;
  newPath(): void;
  closePath(): void;
  fill(): void;
  fillPreserve(): void;
  stroke(): void;
  clip(): void;
  save(): void;
  restore(): void;
}

const SCREEN_COLOR = { r: 0.12, g: 0.12, b: 0.14, a: 1 };
const BEZEL_COLOR = { r: 0.5, g: 0.5, b: 0.55, a: 1 };
const TOP_BAR_COLOR = { r: 0.78, g: 0.78, b: 0.8, a: 0.9 };
const SCREEN_RADIUS = 4;
/** Width of the screen's outline; drawn on half-pixel coordinates to stay crisp. */
const BEZEL_WIDTH = 1;
const TOP_BAR_HEIGHT = 8;
/** Gap between a corner control and the picture's edges (below the top bar on top). */
const CORNER_MARGIN = 8;
const CORNER_SIZE = 28;

/**
 * The corner controls are drawn on the dark picture in both light and dark
 * styles: an inactive toggle is an outline, an active one is filled with
 * the accent colour and shows a check mark.
 */
const CSS = `
.zatto-corner {
  min-width: 0;
  min-height: 0;
  padding: 0;
  border-radius: 4px;
  background: transparent;
  box-shadow: inset 0 0 0 2px alpha(white, 0.65);
}
.zatto-corner image { color: transparent; }
.zatto-corner:hover { background: alpha(white, 0.15); }
.zatto-corner:checked {
  background: @accent_bg_color;
  box-shadow: none;
}
.zatto-corner:checked image { color: @accent_fg_color; }
.zatto-corner:checked:hover { background: mix(@accent_bg_color, white, 0.15); }
`;

let cssInstalled = false;

/** Install the corner controls' style once per preferences process. */
function installCss(): void {
  const display = Gdk.Display.get_default();
  if (cssInstalled || display === null) {
    return;
  }
  const provider = new Gtk.CssProvider();
  provider.load_from_string(CSS);
  Gtk.StyleContext.add_provider_for_display(
    display,
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
  );
  cssInstalled = true;
}

/**
 * The size of the primary monitor in logical pixels, or `undefined` when it
 * cannot be read. GTK 4 has no notion of a primary monitor, so the first
 * monitor of the default display stands for it. The compositor's order
 * need not put the primary monitor first, so with monitors of different
 * shapes the picture may take another monitor's aspect ratio; only the
 * picture's shape is affected, not which corners are stored.
 */
function readMonitorSize(): { width: number; height: number } | undefined {
  try {
    const monitor = Gdk.Display.get_default()?.get_monitors().get_item(0);
    if (!(monitor instanceof Gdk.Monitor)) {
      return undefined;
    }
    const { width, height } = monitor.get_geometry();
    return { width, height };
  } catch (error) {
    console.warn(`[Zatto] Cannot read the monitor size for the corner picture: ${error}`);
    return undefined;
  }
}

function align(edge: PictureEdge): Gtk.Align {
  return edge === 'start' ? Gtk.Align.START : Gtk.Align.END;
}

/** Trace a rounded rectangle as the current path. */
function roundedRect(cr: CairoContext, x: number, y: number, w: number, h: number, r: number) {
  const quarter = Math.PI / 2;
  cr.newPath();
  cr.arc(x + w - r, y + r, r, -quarter, 0);
  cr.arc(x + w - r, y + h - r, r, 0, quarter);
  cr.arc(x + r, y + h - r, r, quarter, 2 * quarter);
  cr.arc(x + r, y + r, r, 2 * quarter, 3 * quarter);
  cr.closePath();
}

/** The drawn screen: a rounded rectangle with a top bar along its top edge. */
function createScreen(width: number, height: number): Gtk.DrawingArea {
  const area = new Gtk.DrawingArea({ content_width: width, content_height: height });
  area.set_draw_func((_area, context, w, h) => {
    const cr = context as unknown as CairoContext;
    const inset = BEZEL_WIDTH / 2;
    roundedRect(cr, inset, inset, w - 2 * inset, h - 2 * inset, SCREEN_RADIUS);
    cr.setSourceRGBA(SCREEN_COLOR.r, SCREEN_COLOR.g, SCREEN_COLOR.b, SCREEN_COLOR.a);
    cr.fillPreserve();
    cr.save();
    cr.clip();
    cr.setSourceRGBA(TOP_BAR_COLOR.r, TOP_BAR_COLOR.g, TOP_BAR_COLOR.b, TOP_BAR_COLOR.a);
    cr.rectangle(0, 0, w, BEZEL_WIDTH + TOP_BAR_HEIGHT);
    cr.fill();
    cr.restore();
    roundedRect(cr, inset, inset, w - 2 * inset, h - 2 * inset, SCREEN_RADIUS);
    cr.setSourceRGBA(BEZEL_COLOR.r, BEZEL_COLOR.g, BEZEL_COLOR.b, BEZEL_COLOR.a);
    cr.setLineWidth(BEZEL_WIDTH);
    cr.stroke();
  });
  return area;
}

/** Place `widget` at a corner of the picture, clear of the edges and the top bar. */
function placeAtCorner(widget: Gtk.Widget, horizontal: PictureEdge, vertical: PictureEdge) {
  widget.set_halign(align(horizontal));
  widget.set_valign(align(vertical));
  widget.set_margin_start(CORNER_MARGIN);
  widget.set_margin_end(CORNER_MARGIN);
  widget.set_margin_top(TOP_BAR_HEIGHT + CORNER_MARGIN);
  widget.set_margin_bottom(CORNER_MARGIN);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

const GNOME_INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const GNOME_HOT_CORNERS_KEY = 'enable-hot-corners';

/**
 * GNOME's own interface settings, or `null` when their schema or the
 * `enable-hot-corners` key is missing; the page then never mentions GNOME's
 * hot corner. zatto only reads this setting and never changes it.
 */
function openGnomeInterfaceSettings(): Gio.Settings | null {
  try {
    const schema = Gio.SettingsSchemaSource.get_default()?.lookup(GNOME_INTERFACE_SCHEMA, true);
    if (!schema?.has_key(GNOME_HOT_CORNERS_KEY)) {
      return null;
    }
    return new Gio.Settings({ schema_id: GNOME_INTERFACE_SCHEMA });
  } catch (error) {
    console.warn(`[Zatto] Cannot read GNOME's hot corner setting: ${error}`);
    return null;
  }
}

/**
 * Build the page. The toggles follow outside changes of the setting, and
 * the description also follows GNOME's `enable-hot-corners`, while `window`
 * is open; the listeners go away when the window closes.
 */
export function createHotCornersPage(
  settings: Gio.Settings,
  window: Adw.PreferencesWindow
): Adw.PreferencesPage {
  installCss();
  const page = new Adw.PreferencesPage({
    title: 'General',
    icon_name: 'preferences-system-symbolic',
  });
  const group = new Adw.PreferencesGroup({ title: 'Hot corners' });
  page.add(group);

  const monitor = readMonitorSize();
  const size = pictureSize(monitor?.width, monitor?.height);
  const picture = new Gtk.Overlay({ halign: Gtk.Align.CENTER, margin_top: 6 });
  picture.set_child(createScreen(size.width, size.height));

  const read = (): HotCorner[] => parseHotCorners(settings.get_strv(HOT_CORNERS_KEY));

  const toggles: { corner: HotCorner; toggle: Gtk.ToggleButton }[] = [];
  for (const { corner, horizontal, vertical, label } of CORNER_PLACEMENTS) {
    const toggle = new Gtk.ToggleButton({
      icon_name: 'object-select-symbolic',
      tooltip_text: label,
      width_request: CORNER_SIZE,
      height_request: CORNER_SIZE,
    });
    toggle.add_css_class('zatto-corner');
    toggle.update_property([Gtk.AccessibleProperty.LABEL], [label]);
    toggle.connect('toggled', () => {
      const stored = settings.get_strv(HOT_CORNERS_KEY);
      const next = withHotCorner(stored, corner, toggle.get_active());
      // Skip a write that changes nothing, so syncing a toggle from an
      // outside change does not write the setting back.
      if (!sameList(stored, next)) {
        settings.set_strv(HOT_CORNERS_KEY, next);
      }
    });
    placeAtCorner(toggle, horizontal, vertical);
    picture.add_overlay(toggle);
    toggles.push({ corner, toggle });
  }

  const gnomeInterface = openGnomeInterfaceSettings();

  const description = new Gtk.Label({ wrap: true, xalign: 0, margin_top: 12 });
  description.add_css_class('dim-label');

  const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  content.append(picture);
  content.append(description);
  group.add(content);

  const sync = (): void => {
    const corners = read();
    for (const { corner, toggle } of toggles) {
      const active = corners.includes(corner);
      if (toggle.get_active() !== active) {
        toggle.set_active(active);
      }
    }
    description.set_label(
      describeHotCorners(corners, gnomeInterface?.get_boolean(GNOME_HOT_CORNERS_KEY))
    );
  };
  sync();

  const changedId = settings.connect(`changed::${HOT_CORNERS_KEY}`, sync);
  const gnomeChangedId = gnomeInterface?.connect(`changed::${GNOME_HOT_CORNERS_KEY}`, sync);
  window.connect('close-request', () => {
    settings.disconnect(changedId);
    if (gnomeChangedId !== undefined) {
      gnomeInterface?.disconnect(gnomeChangedId);
    }
    return false;
  });

  return page;
}
