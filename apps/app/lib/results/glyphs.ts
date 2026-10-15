/**
 * Entity glyphs: the graph has no entity hues (design.md §3), so an entity's kind is carried by the SHAPE of its
 * node. The same shapes appear in the legend, the type chips, the type labels and the SVG export, so a reader
 * learns them once. Pure data and SVG strings: safe for server components, the WebGL program and the exporter.
 */
import { entityCategory, type EntityType } from "@voidaccess/engine-client";

/** Shape ids, shared with the WebGL node program (lib/results/node-glyph-program.ts). */
export const SHAPE = {
  dot: 0,
  ring: 1,
  contour: 2,
  square: 3,
  squareOpen: 4,
  diamond: 5,
  diamondOpen: 6,
  triangle: 7,
  dashed: 8,
} as const;
export type ShapeName = keyof typeof SHAPE;

export interface Glyph {
  shape: ShapeName;
  /** the family name used in the legend, e.g. "Threat actors" */
  family: string;
}

const BY_CATEGORY: Record<string, Glyph> = {
  threat: { shape: "contour", family: "Actors" },
  malware: { shape: "diamond", family: "Malware" },
  vulnerability: { shape: "squareOpen", family: "Vulnerabilities" },
  crypto: { shape: "square", family: "Wallets" },
  network: { shape: "ring", family: "Infrastructure" },
  indicator: { shape: "ring", family: "Infrastructure" },
  credential: { shape: "diamondOpen", family: "Handles and credentials" },
  identity: { shape: "diamondOpen", family: "Handles and credentials" },
  messaging: { shape: "diamondOpen", family: "Handles and credentials" },
  org: { shape: "triangle", family: "Organisations" },
  other: { shape: "dot", family: "Other" },
};

/** Archive-context nodes (from earlier findings) are a dashed ring, whatever their type. */
export const ARCHIVE_GLYPH: Glyph = { shape: "dashed", family: "Archive context" };

export function glyphFor(type: string): Glyph {
  try {
    return BY_CATEGORY[entityCategory(type as EntityType)] ?? BY_CATEGORY.other!;
  } catch {
    return BY_CATEGORY.other!;
  }
}

/** Families in a stable legend order, with the shapes present in `types`. */
export function legendFor(types: string[]): Glyph[] {
  const order = Object.values(BY_CATEGORY);
  const seen = new Set(types.map((t) => glyphFor(t).family));
  const out: Glyph[] = [];
  for (const g of order) if (seen.has(g.family) && !out.some((o) => o.family === g.family)) out.push(g);
  return out;
}

const f = (n: number) => +n.toFixed(2);

/**
 * SVG markup for a glyph centred on (cx, cy) with radius r. `color` paints strokes and fills; hollow shapes are
 * filled with `bg` so lines behind them are hidden (the terrain's hidden-line rule).
 */
export function glyphSvg(
  shape: ShapeName,
  cx: number,
  cy: number,
  r: number,
  color: string,
  bg: string,
  opacity = 1,
  stroke = 1,
): string {
  const op = opacity < 1 ? ` opacity="${f(opacity)}"` : "";
  const open = `fill="${bg}" stroke="${color}" stroke-width="${stroke}"`;
  const solid = `fill="${color}"`;
  const sq = (s: number, a: string) =>
    `<rect x="${f(cx - s)}" y="${f(cy - s)}" width="${f(2 * s)}" height="${f(2 * s)}" ${a}${op}/>`;
  const di = (d: number, a: string) =>
    `<path d="M${f(cx)} ${f(cy - d)}L${f(cx + d)} ${f(cy)}L${f(cx)} ${f(cy + d)}L${f(cx - d)} ${f(cy)}Z" ${a}${op}/>`;
  const so = stroke / 2;
  switch (shape) {
    case "dot":
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${solid}${op}/>`;
    case "ring":
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r - so)}" ${open}${op}/>`;
    case "dashed": {
      const c = 2 * Math.PI * (r - so);
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r - so)}" ${open} stroke-dasharray="${f(c / 16)} ${f(c / 16)}"${op}/>`;
    }
    case "contour":
      return `<g${op}><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r - so)}" ${open}/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.4)}" ${solid}/></g>`;
    case "square":
      return sq(r * 0.86, solid);
    case "squareOpen":
      return sq(r * 0.86 - so, open);
    case "diamond":
      return di(r * 1.2, solid);
    case "diamondOpen":
      return di(r * 1.2 - so * 1.41, open);
    case "triangle": {
      const R = r * 1.2;
      const pts = [0, 1, 2].map((i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        return `${f(cx + Math.cos(a) * R)} ${f(cy + 0.2 * R + Math.sin(a) * R)}`;
      });
      return `<path d="M${pts.join("L")}Z" ${solid}${op}/>`;
    }
  }
}
