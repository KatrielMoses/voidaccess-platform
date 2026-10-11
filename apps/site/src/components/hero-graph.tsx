import graph from "@content/graph-hero.json";
import { hero } from "@content/home";

type NodeType = "actor" | "malware" | "cve" | "onion" | "handle";

const COLOR: Record<NodeType, string> = {
  actor: "var(--color-entity-actor)",
  malware: "var(--color-entity-malware)",
  cve: "var(--color-entity-cve)",
  onion: "var(--color-entity-onion)",
  handle: "var(--color-entity-pgp)",
};
const LEGEND: { type: NodeType; label: string }[] = [
  { type: "actor", label: "Group / actor" },
  { type: "malware", label: "Malware" },
  { type: "cve", label: "CVE" },
  { type: "onion", label: "Onion service (fake)" },
  { type: "handle", label: "Handle (fake)" },
];

const W = 640;
const H = 520;
const PAD = 56;
const px = (x: number) => PAD + ((x + 1) / 2) * (W - 2 * PAD);
const py = (y: number) => PAD + ((y + 1) / 2) * (H - 2 * PAD);

const shorten = (id: string) => (id.endsWith(".onion") ? `${id.slice(0, 6)}….onion` : id);

/**
 * Static SVG from redacted real E0 data (content/graph-hero.json). Animation is pure CSS, so this
 * ships no client JS, and reduced-motion users get the finished frame.
 */
export function HeroGraph() {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const hub = graph.nodes.reduce((a, b) => ((degree.get(b.id) ?? 0) > (degree.get(a.id) ?? 0) ? b : a));

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={hero.graphAlt} className="h-auto w-full">
        <defs>
          <radialGradient id="va-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#va-glow)" />
        <g stroke="var(--color-border-strong)" strokeWidth="1.2" fill="none">
          {graph.edges.map((e, i) => {
            const a = byId.get(e.a)!;
            const b = byId.get(e.b)!;
            return (
              <line
                key={`${e.a}-${e.b}`}
                className="va-edge"
                pathLength={1}
                x1={px(a.x)}
                y1={py(a.y)}
                x2={px(b.x)}
                y2={py(b.y)}
                style={{ ["--d" as string]: `${0.5 + i * 0.12}s` }}
              />
            );
          })}
        </g>
        {graph.nodes.map((n, i) => {
          const x = px(n.x);
          const y = py(n.y);
          const r = n.r * 1.5;
          const big = (degree.get(n.id) ?? 0) >= 3;
          const d = `${0.2 + i * 0.1}s`;
          return (
            <g key={n.id} style={{ ["--d" as string]: d }}>
              {n.id === hub.id && <circle className="va-pulse" cx={x} cy={y} r={r + 4} fill="none" stroke={COLOR[n.type as NodeType]} strokeWidth="1.5" />}
              <circle className="va-node" cx={x} cy={y} r={r} fill={COLOR[n.type as NodeType]} fillOpacity="0.9" stroke="var(--color-void)" strokeWidth="2" style={{ ["--d" as string]: d }}>
                <title>{n.id}</title>
              </circle>
              <text
                x={x}
                y={y + r + 13}
                textAnchor="middle"
                className={`fill-fg-secondary font-mono ${big ? "text-[11px]" : "text-[10px] max-sm:hidden"}`}
              >
                {shorten(n.id)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 text-xs leading-relaxed text-fg-secondary">
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {LEGEND.map((l) => (
            <li key={l.type} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: COLOR[l.type] }} />
              {l.label}
            </li>
          ))}
        </ul>
        {hero.graphCaption}
      </figcaption>
    </figure>
  );
}
