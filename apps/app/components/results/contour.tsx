/**
 * The entity cards' contour drawing (design.md §6 entity card, site/js/app.js): concentric, slightly uneven
 * rings, deterministic per seed. The parent sets `group`; on hover or focus the rings brighten and the innermost
 * ring turns v-500, the signal.
 */
const RINGS = 5;

function hash(s: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return (h >>> 0) / 4294967296;
}

function ringPath(seed: string, r: number): string {
  const base = 102 - r * 17;
  const waves = [2, 3, 5].map((k, i) => ({
    k,
    amp: (0.07 + 0.06 * hash(seed, i * 7 + 1)) / (i + 1),
    ph: hash(seed, i * 7 + 2) * Math.PI * 2 + r * 0.45,
  }));
  const cx = (hash(seed, 31) - 0.5) * 22 * (1 - r / RINGS);
  const cy = (hash(seed, 37) - 0.5) * 14 * (1 - r / RINGS) + 9 * (r / RINGS);
  let d = "";
  for (let a = 0; a <= 72; a++) {
    const th = (a / 72) * Math.PI * 2;
    const n = waves.reduce((s, w) => s + w.amp * Math.sin(w.k * th + w.ph), 0);
    const rad = base * (1 + n);
    d += `${a ? "L" : "M"}${(cx + Math.cos(th) * rad).toFixed(1)} ${(cy + Math.sin(th) * rad * 0.72).toFixed(1)}`;
  }
  return `${d}Z`;
}

export function Contour({ seed, className }: { seed: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="-115 -85 230 170" className={className} fill="none" overflow="visible">
      {Array.from({ length: RINGS }, (_, r) => (
        <path
          key={r}
          d={ringPath(seed, r)}
          vectorEffect="non-scaling-stroke"
          strokeWidth={1}
          className={
            r === RINGS - 1
              ? "stroke-paper/55 transition-[stroke] duration-[600ms] ease-out group-hover:stroke-v-500 group-focus-within:stroke-v-500"
              : "stroke-paper/28 transition-[stroke] duration-[600ms] ease-out group-hover:stroke-paper/45 group-focus-within:stroke-paper/45"
          }
        />
      ))}
    </svg>
  );
}
