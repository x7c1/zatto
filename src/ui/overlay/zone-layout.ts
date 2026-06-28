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
 *   - {@link packIntoZone} packs N aspect-preserving items into a zone
 *     rect using a justified-row shelf packer that mimics the Activities
 *     Overview's visual feel (denser than a uniform grid, no large empty
 *     bands).
 *
 * The zone identifiers, the per-zone fractional rects, the `wm_class`
 * routing table, the fallback choice, and the inter-window gap all live
 * in `zone-config.ts`; this module never imports them. That separation
 * is what lets a future loader swap the data without touching the math.
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

/** A source item with intrinsic pixel dimensions used to derive its aspect ratio. */
export interface Sized {
  readonly w: number;
  readonly h: number;
}

/** Options for {@link packIntoZone}. */
export interface PackOptions {
  /**
   * Pixel gap between adjacent items within a row, and between rows.
   * Defaults to `0` so the pure module stays ignorant of any
   * configuration concept; callers (e.g. `GnomeWindowMirror`) inject the
   * value from `ZoneConfig.windowGapPx`.
   */
  readonly gap?: number;
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
 * Pack `sources` into `zone` as a stack of justified rows.
 *
 * The algorithm is a deterministic shelf packer:
 *
 *   1. For each candidate row count `R` from `1` to `n`, split the
 *      input sources contiguously into `R` rows at indices
 *      `Math.round(i * n / R)` (input order preserved both within and
 *      across rows).
 *   2. For a row of `k` items with aspect ratios `a_1..a_k`, compute a
 *      row height `rowH = (zoneW - (k-1)*gap) / sum(a_i)` and give each
 *      item a width of `a_i * rowH`. This makes the row exactly fill
 *      `zoneW` after gaps and gives every item in the row the same
 *      height — the "justified" property that produces the dense look.
 *   3. Stack rows top-to-bottom with `gap` between rows. If the stacked
 *      total height exceeds `zoneH`, scale the whole layout uniformly
 *      down so it fits, and re-center vertically.
 *   4. Score every candidate `R` by the minimum item height it produces
 *      (after the scale-down step). Pick the candidate with the largest
 *      minimum height; on a tie, prefer fewer rows (taller cells).
 *
 * Output rects are zone-origin-relative, matching the convention of the
 * previous grid implementation: the caller does not have to re-translate
 * coordinates when attaching clones to a zone-aligned container.
 *
 * Edge cases:
 *   - `sources.length === 0` returns `[]`.
 *   - A source with `w <= 0` or `h <= 0` is treated as aspect `1` so a
 *     transient `0x0` window report from Mutter cannot crash the packer
 *     or produce NaN rects.
 *   - A zone with `w <= 0` or `h <= 0` returns `[]`; nothing meaningful
 *     can be drawn in zero area.
 */
export function packIntoZone(
  zone: PixelRect,
  sources: ReadonlyArray<Sized>,
  options: PackOptions = {}
): PixelRect[] {
  const n = sources.length;
  if (n === 0) {
    return [];
  }
  if (zone.w <= 0 || zone.h <= 0) {
    return [];
  }

  const gap = options.gap ?? 0;
  const aspects = sources.map(safeAspect);

  let best: { rects: PixelRect[]; minHeight: number; rowCount: number } | null = null;

  for (let R = 1; R <= n; R++) {
    const rows: number[][] = [];
    for (let r = 0; r < R; r++) {
      const start = Math.round((r * n) / R);
      const end = Math.round(((r + 1) * n) / R);
      const indices: number[] = [];
      for (let i = start; i < end; i++) {
        indices.push(i);
      }
      // `Math.round` based slicing can in principle produce an empty
      // row when `R > n` (skipped above) or with pathological rounding
      // ties; guard so we never feed an empty row into the row-height
      // formula (sum(a_i) = 0 would NaN it).
      if (indices.length === 0) {
        continue;
      }
      rows.push(indices);
    }
    if (rows.length === 0) {
      continue;
    }

    // Per-row width given a row height `rowH`:
    //   widthOfRow(rowH) = sum(a_i)*rowH + (k-1)*gap
    // We invert that to make widthOfRow == zone.w:
    //   rowH = (zone.w - (k-1)*gap) / sum(a_i)
    const rowHeights: number[] = [];
    for (const row of rows) {
      const k = row.length;
      let sumA = 0;
      for (const idx of row) {
        sumA += aspects[idx];
      }
      // Degenerate sumA cannot happen because `safeAspect` floors at 1
      // for non-positive inputs, but guard anyway so a future change to
      // `safeAspect` doesn't silently divide by zero.
      const available = zone.w - (k - 1) * gap;
      const rowH = sumA > 0 ? available / sumA : 0;
      rowHeights.push(rowH);
    }

    const totalRowHeight = rowHeights.reduce((a, b) => a + b, 0);
    const totalGap = (rows.length - 1) * gap;
    const totalHeight = totalRowHeight + totalGap;

    // Uniform scale-down if the stack overflows the zone height. Gaps
    // scale with the rest so the visual proportions stay consistent.
    const scale = totalHeight > zone.h ? zone.h / totalHeight : 1;

    const scaledTotalHeight = totalHeight * scale;
    const scaledGap = gap * scale;
    const yOffset = (zone.h - scaledTotalHeight) / 2;

    const rects: PixelRect[] = new Array(n);
    let minHeight = Number.POSITIVE_INFINITY;
    let y = zone.y + yOffset;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rowH = rowHeights[r] * scale;
      // Width of each item is `aspect * rowH`. After scale-down the
      // per-row widths re-sum to `scale * zone.w - (k-1)*scaledGap`,
      // which is narrower than `zone.w`; center the row horizontally so
      // a scaled stack stays centered rather than slumping to the left.
      let rowContentW = 0;
      for (const idx of row) {
        rowContentW += aspects[idx] * rowH;
      }
      const rowTotalW = rowContentW + (row.length - 1) * scaledGap;
      const xOffset = (zone.w - rowTotalW) / 2;
      let x = zone.x + xOffset;
      for (const idx of row) {
        const w = aspects[idx] * rowH;
        const h = rowH;
        rects[idx] = { x, y, w, h };
        if (h < minHeight) {
          minHeight = h;
        }
        x += w + scaledGap;
      }
      y += rowH + scaledGap;
    }

    if (best === null) {
      best = { rects, minHeight, rowCount: rows.length };
      continue;
    }
    // Maximize min-height; on a tie, prefer fewer rows. Equal-min
    // candidates with the same row count keep the earlier (smaller R)
    // winner, which is already the "fewer rows" preference baked in.
    if (
      minHeight > best.minHeight ||
      (minHeight === best.minHeight && rows.length < best.rowCount)
    ) {
      best = { rects, minHeight, rowCount: rows.length };
    }
  }

  return best === null ? [] : best.rects;
}

/**
 * Aspect ratio of a source, with a `1.0` fallback for degenerate
 * (`<= 0`) dimensions. Mutter occasionally reports `0x0` frame rects
 * for windows that are mid-resize or transient; treating those as
 * square keeps the packer crash-free and still lays out something
 * clickable instead of producing `NaN` rects.
 */
function safeAspect(s: Sized): number {
  if (s.w <= 0 || s.h <= 0) {
    return 1;
  }
  return s.w / s.h;
}
