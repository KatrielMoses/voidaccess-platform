/** PNG and SVG export of the current graph view, each carrying an "Investigated with VoidAccess" footer. */
import type Sigma from "sigma";

export const FOOTER_TEXT = "Investigated with VoidAccess";
const BG = "#080b11";

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
        ctx.fillStyle = "#8b949e";
        ctx.font = `${12 * ratio}px ui-sans-serif, system-ui, sans-serif`;
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

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface SvgNode {
  x: number;
  y: number;
  r: number;
  color: string;
  label: string | null;
}
export interface SvgEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

/** Builds the SVG text; all text content is XML-escaped. Pure so it can be unit tested. */
export function buildSvg(
  width: number,
  height: number,
  nodes: SvgNode[],
  edges: SvgEdge[],
  legend: { label: string; color: string }[],
): string {
  const footerH = 28;
  const f = (n: number) => n.toFixed(1);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + footerH}" viewBox="0 0 ${width} ${height + footerH}" font-family="ui-sans-serif, system-ui, sans-serif">`,
    `<rect width="100%" height="100%" fill="${BG}"/>`,
    `<g stroke-linecap="round">`,
    ...edges.map(
      (e) =>
        `<line x1="${f(e.x1)}" y1="${f(e.y1)}" x2="${f(e.x2)}" y2="${f(e.y2)}" stroke="${esc(e.color)}" stroke-width="${e.width}"/>`,
    ),
    `</g>`,
    ...nodes.map(
      (n) =>
        `<circle cx="${f(n.x)}" cy="${f(n.y)}" r="${f(n.r)}" fill="${esc(n.color)}" stroke="${BG}" stroke-width="1"/>`,
    ),
    ...nodes
      .filter((n) => n.label)
      .map(
        (n) =>
          `<text x="${f(n.x)}" y="${f(n.y + n.r + 11)}" font-size="10" text-anchor="middle" fill="#c9d1d9" stroke="${BG}" stroke-width="3" paint-order="stroke">${esc(n.label!)}</text>`,
      ),
    ...legend.map(
      (l, i) =>
        `<g transform="translate(12 ${18 + i * 14})"><circle r="4" fill="${esc(l.color)}"/><text x="10" y="4" font-size="10" fill="#8b949e">${esc(l.label)}</text></g>`,
    ),
    `<text x="12" y="${height + footerH / 2 + 4}" font-size="12" fill="#8b949e">${esc(FOOTER_TEXT)}</text>`,
    `</svg>`,
  ];
  return parts.join("\n");
}

export function downloadSvg(svg: string, filename: string) {
  download(new Blob([svg], { type: "image/svg+xml" }), filename);
}
