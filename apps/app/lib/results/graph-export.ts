/** PNG and SVG export of the current graph view, each carrying an "Investigated with VoidAccess" footer. */
import type Sigma from "sigma";
import { glyphSvg, type ShapeName } from "./glyphs";
import { FIELD } from "./graph-model";

export const FOOTER_TEXT = "Investigated with VoidAccess";
/** Exports use the app's palette: the field, paper hairlines, mono labels (design.md §3, §7). */
const BG = FIELD;
const MUTE = "rgba(243,241,236,0.54)";
const DIM = "rgba(243,241,236,0.66)";
const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, monospace';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Composites sigma's canvas layers inside afterRender, when the WebGL buffers are guaranteed intact. */
export function exportPng(sigma: Sigma, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sigma.once("afterRender", () => {
      try {
        const { width, height } = sigma.getDimensions();
        const ratio = window.devicePixelRatio || 1;
        const footer = 28 * ratio;
        const out = document.createElement("canvas");
        out.width = Math.round(width * ratio);
        out.height = Math.round(height * ratio + footer);
        const ctx = out.getContext("2d");
        if (!ctx) throw new Error("2d canvas unavailable");
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, out.width, out.height);
        const layers = sigma.getCanvases();
        for (const name of ["edges", "nodes", "labels"]) {
          const c = layers[name];
          if (c && c.width > 0 && c.height > 0) ctx.drawImage(c, 0, 0, out.width, out.height - footer);
        }
        ctx.fillStyle = "rgba(243,241,236,0.14)";
        ctx.fillRect(0, out.height - footer, out.width, Math.max(1, ratio));
        ctx.fillStyle = MUTE;
        ctx.font = `${12 * ratio}px ${MONO}`;
        ctx.textBaseline = "middle";
        ctx.fillText(FOOTER_TEXT, 12 * ratio, out.height - footer / 2);
        out.toBlob((blob) => {
          if (!blob) return reject(new Error("PNG encoding failed"));
          download(blob, filename);
          resolve();
        }, "image/png");
      } catch (e) {
        reject(e);
      }
    });
    sigma.refresh();
  });
}

/** `color` (#rrggbb) mixed into the field at `a`; anything else is escaped and passed through. */
export function mixHex(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return esc(color);
  const c = parseInt(m[1]!, 16);
  const ch = (shift: number, bg: number) => Math.round(bg + (((c >> shift) & 255) - bg) * a);
  const out = (ch(16, 15) << 16) | (ch(8, 15) << 8) | ch(0, 18);
  return `#${out.toString(16).padStart(6, "0")}`;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface SvgNode {
  x: number;
  y: number;
  r: number;
  color: string;
  label: string | null;
  /** glyph (lib/results/glyphs.ts); a dot when omitted */
  shape?: ShapeName;
  /** 0..1 intensity, as in the live graph */
  opacity?: number;
}
export interface SvgEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  opacity?: number;
}

/** Builds the SVG text; all text content is XML-escaped. Pure so it can be unit tested. */
export function buildSvg(
  width: number,
  height: number,
  nodes: SvgNode[],
  edges: SvgEdge[],
  legend: { label: string; color: string; shape?: ShapeName }[],
): string {
  const footerH = 28;
  const f = (n: number) => n.toFixed(1);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + footerH}" viewBox="0 0 ${width} ${height + footerH}" font-family='${MONO}'>`,
    `<rect width="100%" height="100%" fill="${BG}"/>`,
    `<g stroke-linecap="round">`,
    ...edges.map(
      (e) =>
        `<line x1="${f(e.x1)}" y1="${f(e.y1)}" x2="${f(e.x2)}" y2="${f(e.y2)}" stroke="${esc(e.color)}" stroke-width="${e.width}"${e.opacity !== undefined ? ` stroke-opacity="${e.opacity}"` : ""}/>`,
    ),
    `</g>`,
    // hollow glyphs are filled with the field so the hairlines behind them are hidden
    // intensity is pre-mixed into the field so nodes stay opaque, as on screen
    ...nodes.map((n) => glyphSvg(n.shape ?? "dot", n.x, n.y, n.r, mixHex(n.color, n.opacity ?? 1), BG)),
    ...nodes
      .filter((n) => n.label)
      .map(
        (n) =>
          `<text x="${f(n.x + n.r * 1.25 + 4)}" y="${f(n.y + 3.5)}" font-size="10" fill="${DIM}" stroke="${BG}" stroke-width="3" paint-order="stroke">${esc(n.label!)}</text>`,
      ),
    ...legend.map(
      (l, i) =>
        `<g transform="translate(16 ${20 + i * 18})">${glyphSvg(l.shape ?? "dot", 0, 0, 4.4, esc(l.color), BG)}<text x="12" y="3.5" font-size="11" fill="${DIM}">${esc(l.label)}</text></g>`,
    ),
    `<line x1="0" y1="${height + 0.5}" x2="${width}" y2="${height + 0.5}" stroke="rgba(243,241,236,0.14)"/>`,
    `<text x="16" y="${height + footerH / 2 + 4}" font-size="12" fill="${MUTE}">${esc(FOOTER_TEXT)}</text>`,
    `</svg>`,
  ];
  return parts.join("\n");
}

export function downloadSvg(svg: string, filename: string) {
  download(new Blob([svg], { type: "image/svg+xml" }), filename);
}
