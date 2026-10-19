/* global URL, console */
// Product images for the Creem checkout: 1200x1200, design.md look (ink, hairlines, one violet thing).
import { writeFileSync } from "node:fs";
const W = 1200;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// terrain: contour-like horizontal lines displaced by smooth noise, flattening toward the right (noise cleared)
function terrain(seed, y0, y1, rows, amp) {
  const r = rng(seed); const ph = [...Array(6)].map(() => r() * 6.28);
  let out = "";
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1); const y = y0 + (y1 - y0) * t; let d = "";
    for (let x = 0; x <= W; x += 12) {
      const fade = Math.max(0, 1 - x / (W * 0.95));
      const n = Math.sin(x / 70 + ph[0] + i * 0.35) * 0.5 + Math.sin(x / 31 + ph[1] - i * 0.2) * 0.3 + Math.sin(x / 13 + ph[2] + i) * 0.2;
      d += `${x ? "L" : "M"}${x},${(y - n * amp * fade * (0.4 + 0.6 * t)).toFixed(1)}`;
    }
    out += `<path d="${d}" fill="none" stroke="rgba(243,241,236,${(0.08 + 0.22 * t).toFixed(3)})" stroke-width="1.2"/>`;
  }
  return out;
}
// signal: the one violet line
function signal(seed, y, amp) {
  const r = rng(seed); const p = r() * 6.28; let d = "";
  for (let x = 0; x <= W; x += 8) d += `${x ? "L" : "M"}${x},${(y + Math.sin(x / 120 + p) * amp * (x / W)).toFixed(1)}`;
  return `<path d="${d}" fill="none" stroke="#6E6BE8" stroke-width="2.4"/>`;
}
// graph: nodes in a region, edges to near neighbours; glyph shapes like the app
function graph(seed, n, box, violetIdx) {
  const r = rng(seed); const pts = [...Array(n)].map(() => [box[0] + r() * (box[2] - box[0]), box[1] + r() * (box[3] - box[1])]);
  let e = "", v = "";
  pts.forEach((p, i) => {
    const near = pts.map((q, j) => [Math.hypot(p[0] - q[0], p[1] - q[1]), j]).filter(([, j]) => j !== i).sort((a, b) => a[0] - b[0]).slice(0, 3);
    for (const [, j] of near) if (j > i) e += `<line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${pts[j][0].toFixed(1)}" y2="${pts[j][1].toFixed(1)}" stroke="rgba(243,241,236,.18)" stroke-width="1.2"/>`;
  });
  pts.forEach((p, i) => {
    const k = Math.floor(r() * 4), s = 5 + r() * 4, c = i === violetIdx ? "#6E6BE8" : "#F3F1EC";
    const [x, y] = p.map((z) => z.toFixed(1));
    if (k === 0) v += `<circle cx="${x}" cy="${y}" r="${s}" fill="${c}"/>`;
    else if (k === 1) v += `<circle cx="${x}" cy="${y}" r="${s + 2}" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="2.4" fill="${c}"/>`;
    else if (k === 2) v += `<rect x="${(p[0] - s).toFixed(1)}" y="${(p[1] - s).toFixed(1)}" width="${2 * s}" height="${2 * s}" fill="none" stroke="${c}" stroke-width="1.6"/>`;
    else v += `<path d="M${x},${(p[1] - s - 2).toFixed(1)} L${(p[0] + s + 2).toFixed(1)},${y} L${x},${(p[1] + s + 2).toFixed(1)} L${(p[0] - s - 2).toFixed(1)},${y} Z" fill="${c}"/>`;
    if (i === violetIdx) v += `<circle cx="${x}" cy="${y}" r="${s + 14}" fill="none" stroke="#6E6BE8" stroke-opacity=".5" stroke-width="1.2"/>`;
  });
  return e + v;
}
// seats: a 10x10 grid of seat marks, one violet (yours)
function seats(x0, y0, gap) {
  let s = "";
  for (let i = 0; i < 100; i++) {
    const x = x0 + (i % 10) * gap, y = y0 + Math.floor(i / 10) * gap;
    s += i === 23 ? `<rect x="${x - 9}" y="${y - 9}" width="18" height="18" rx="3" fill="#6E6BE8"/>` : `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="3" fill="none" stroke="rgba(243,241,236,.35)" stroke-width="1.4"/>`;
  }
  return s;
}
// credit ledger bars: pay-as-you-go
function bars(x0, y0, h) {
  const v = [5, 10, 25, 50, 100, 250, 500]; let s = "";
  v.forEach((d, i) => { const bh = 30 + (Math.log(d) / Math.log(500)) * h; const x = x0 + i * 66;
    s += `<rect x="${x}" y="${y0 - bh}" width="40" height="${bh}" fill="${i === 3 ? "#6E6BE8" : "none"}" stroke="${i === 3 ? "#6E6BE8" : "rgba(243,241,236,.5)"}" stroke-width="1.4"/>`;
    s += `<text x="${x + 20}" y="${y0 + 34}" text-anchor="middle" class="mono" font-size="17" fill="rgba(243,241,236,.55)">$${d}</text>`; });
  return s;
}

const products = [
  { file: "pro-monthly", eyebrow: "PLAN · MONTHLY", title: "Pro", lines: ["2,000 credits every month", "All exports · unlimited history"], art: () => terrain(11, 740, 1010, 22, 70) + graph(4, 24, [620, 250, 1080, 620], 7) },
  { file: "pro-annual", eyebrow: "PLAN · ANNUAL", title: "Pro", sub: "12 months", lines: ["2,000 credits every month", "Billed yearly · 2 months free"], art: () => terrain(12, 740, 1010, 22, 70) + graph(5, 24, [620, 250, 1080, 620], 3) + signal(3, 700, 26) },
  { file: "pro-plus-monthly", eyebrow: "PLAN · MONTHLY", title: "Pro+", lines: ["4,500 credits every month", "Roadmap features first"], art: () => terrain(21, 740, 1010, 26, 80) + graph(8, 40, [600, 230, 1100, 640], 12) },
  { file: "pro-plus-annual", eyebrow: "PLAN · ANNUAL", title: "Pro+", sub: "12 months", lines: ["4,500 credits every month", "Billed yearly · 2 months free"], art: () => terrain(22, 740, 1010, 26, 80) + graph(9, 40, [600, 230, 1100, 640], 20) + signal(5, 700, 26) },
  { file: "pro-founder", eyebrow: "FOUNDING SEAT · MONTHLY", title: "Pro", sub: "Founding member", lines: ["One of the first 100 subscribers", "2,000 credits every month"], art: () => terrain(31, 780, 1010, 18, 55) + seats(700, 270, 42) },
  { file: "credits", eyebrow: "PAY AS YOU GO", title: "Credits", lines: ["Any amount · $1 = 100 credits", "Bonus from $25 · last 12 months"], art: () => terrain(41, 780, 1010, 20, 60) + bars(700, 680, 300) },
];

const head = (dir) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:GS;src:url(${dir}/GeneralSans-500.woff2)}@font-face{font-family:GM;src:url(${dir}/GeistMono-400.woff2)}@font-face{font-family:SO;src:url(${dir}/Sora-500.woff2)}
html,body{margin:0;background:#0F0F12}svg{display:block}.mono{font-family:GM}</style></head><body>`;

for (const p of products) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
  <defs><clipPath id="f"><rect x="41" y="41" width="${W - 82}" height="${W - 82}"/></clipPath></defs>
  <rect width="${W}" height="${W}" fill="#0F0F12"/>
  <g clip-path="url(#f)">${p.art()}</g>
  <rect x="40" y="40" width="${W - 80}" height="${W - 80}" fill="none" stroke="rgba(243,241,236,.14)" stroke-width="1.2"/>
  <image href="logo.png" x="96" y="96" width="56" height="56"/>
  <text x="170" y="136" font-family="SO" font-size="34" letter-spacing="-1" fill="#F3F1EC">voidaccess</text>
  <line x1="96" y1="236" x2="140" y2="236" stroke="rgba(243,241,236,.4)" stroke-width="1.2"/>
  <text x="156" y="243" class="mono" font-size="22" letter-spacing="2" fill="rgba(243,241,236,.6)">${p.eyebrow}</text>
  <text x="90" y="${p.sub ? 420 : 440}" font-family="GS" font-size="170" letter-spacing="-8" fill="#F3F1EC">${p.title}</text>
  ${p.sub ? `<text x="98" y="490" font-family="GS" font-size="44" letter-spacing="-1" fill="#B9B7F4">${p.sub}</text>` : ""}
  ${p.lines.map((l, i) => `<text x="98" y="${(p.sub ? 580 : 540) + i * 48}" font-family="GS" font-size="34" fill="rgba(243,241,236,${i ? 0.6 : 0.9})">${l}</text>`).join("")}
  <text x="98" y="1112" class="mono" font-size="20" letter-spacing="1" fill="rgba(243,241,236,.4)">Dark-web OSINT · hosted · open source</text>
</svg>`;
  writeFileSync(new URL(`./${p.file}.html`, import.meta.url), head(".") + svg + "</body></html>");
}
console.log(products.map((p) => p.file).join(" "));
