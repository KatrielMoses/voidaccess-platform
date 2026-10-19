/**
 * Small results read as small, not broken: every value is labelled, the camera keeps them as a compact cluster in the
 * middle (sigma otherwise stretches a handful of nodes to the canvas corners), and a plain note says what was found.
 */

/** Results up to this many values label every value. */
export const SMALL_GRAPH_LABEL_ALL = 40;

/** Results up to this many values get a note on the canvas. */
export const THIN_RESULT = 12;

/** The least zoomed-out a fit may be (1 = the graph fills the free area; higher = smaller, centred cluster). */
export function minFitRatio(order: number): number {
  if (order <= 3) return 3.2;
  if (order <= 12) return 3;
  if (order <= 40) return 1.35;
  return 0.15;
}

export function thinResultNote(values: number, links: number): string {
  const found = `${values} ${values === 1 ? "value" : "values"} found.`;
  if (links === 0)
    return values === 1
      ? `${found} There's nothing for it to connect to yet.`
      : `${found} None of them appeared together on the same page, so there are no links to draw.`;
  return `${found} A small result: the sources this run reached had little on this query.`;
}

/** A label's footprint on screen: values closer than this sideways AND vertically would overlap. */
export const LABEL_W_PX = 130;
export const LABEL_H_PX = 22;

/**
 * How far the camera may zoom out (ratio, given the points' positions at ratio 1) before two labels overlap: for every
 * pair, the labels stay clear if they're far enough apart either sideways or vertically. Infinity for fewer than two.
 */
export function labelClearance(pts: readonly { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dx = Math.abs(pts[i]!.x - pts[j]!.x) / LABEL_W_PX;
      const dy = Math.abs(pts[i]!.y - pts[j]!.y) / LABEL_H_PX;
      best = Math.min(best, Math.max(dx, dy));
    }
  return best;
}
