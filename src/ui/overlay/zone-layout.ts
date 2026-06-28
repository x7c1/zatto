/**
 * Pure geometry primitives consumed by `ZoneConfig`-driven layout.
 *
 * This module knows nothing about Clutter, Meta, St, or the wider GNOME
 * Shell. It deals in plain numbers so it can be unit-tested in vitest
 * without any GJS shim, and so the production `GnomeWindowMirror` can
 * delegate every layout decision here.
 *
 * The contract is small on purpose:
 *
 *   - {@link rectToPixels} converts a fractional zone rect into pixels
 *     for a given monitor size.
 *   - {@link computeGrid} packs N items into a zone rect as a
 *     `ceil(sqrt(N))`-column grid of equal-sized cells.
 *   - {@link fitContentToCell} centers a source rectangle inside one
 *     cell while preserving its aspect ratio.
 *
 * The zone identifiers, the per-zone fractional rects, the `wm_class`
 * routing table, the fallback choice, and the cell padding all live in
 * `zone-config.ts`; this module never imports them. That separation is
 * what lets a future loader swap the data without touching the math.
 */

/** Identifiers for the four quadrant zones. */
export type ZoneKey = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

/**
 * Fractional rect within the monitor (`x`, `y`, `w`, `h` ∈ `[0, 1]`).
 * Translated to pixels by {@link rectToPixels}.
 */
export interface FractionalRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Pixel rect inside a monitor (origin-relative; absolute origin added later). */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Convert a fractional rect into a pixel rect inside a monitor of the given size. */
export function rectToPixels(
  rect: FractionalRect,
  monitor: { width: number; height: number }
): PixelRect {
  return {
    x: rect.x * monitor.width,
    y: rect.y * monitor.height,
    w: rect.w * monitor.width,
    h: rect.h * monitor.height,
  };
}

/**
 * Lay out `n` items inside `rect` as a grid of equal cells. The grid is
 * `cols = ceil(sqrt(n))` wide and `rows = ceil(n / cols)` tall, which
 * keeps cells roughly square and never wastes more than one row. Cells
 * are returned in row-major order matching the input index.
 *
 * Edge cases:
 *   - `n <= 0` -> empty array (no items, no cells).
 *   - `n == 1` -> single cell equal to the input rect.
 *   - degenerate zero-area rects pass through (callers decide whether to
 *     skip them); we never divide by `n` only, never by the cell count.
 */
export function computeGrid(rect: PixelRect, n: number): PixelRect[] {
  if (n <= 0) {
    return [];
  }
  if (n === 1) {
    return [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h }];
  }
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW = rect.w / cols;
  const cellH = rect.h / rows;
  const cells: PixelRect[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    cells.push({
      x: rect.x + col * cellW,
      y: rect.y + row * cellH,
      w: cellW,
      h: cellH,
    });
  }
  return cells;
}

/**
 * Fit a source rectangle inside a cell preserving its aspect ratio, and
 * center it. Returns the destination rect in absolute coordinates
 * (origin-aligned with the input `cell`).
 *
 * A degenerate source (`w <= 0` or `h <= 0`) collapses to the full cell
 * since we have no aspect to honor — letting the clone fill the cell is
 * less surprising than crashing on a transient `0x0` window report.
 *
 * A degenerate cell (`w <= 0` or `h <= 0`) returns a zero-sized rect at
 * the cell origin; callers can detect and skip these.
 */
export function fitContentToCell(
  cell: PixelRect,
  sourceWidth: number,
  sourceHeight: number,
  options: { padding?: number } = {}
): PixelRect {
  const padding = options.padding ?? 0;
  const innerW = Math.max(0, cell.w - 2 * padding);
  const innerH = Math.max(0, cell.h - 2 * padding);
  if (innerW <= 0 || innerH <= 0) {
    return { x: cell.x, y: cell.y, w: 0, h: 0 };
  }
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return {
      x: cell.x + padding,
      y: cell.y + padding,
      w: innerW,
      h: innerH,
    };
  }
  const aspect = sourceWidth / sourceHeight;
  let w = innerW;
  let h = w / aspect;
  if (h > innerH) {
    h = innerH;
    w = h * aspect;
  }
  const x = cell.x + padding + (innerW - w) / 2;
  const y = cell.y + padding + (innerH - h) / 2;
  return { x, y, w, h };
}
