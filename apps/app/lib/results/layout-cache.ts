/**
 * Layout cache: computed positions are kept per investigation in localStorage. Snapshots are immutable, so
 * the cache is valid until the node set changes (checked with a cheap signature). Reopening is instant.
 */
const KEY = (id: string) => `va:graph-layout:v1:${id}`;

export function signature(ids: string[]): string {
  let h = 2166136261;
  for (const id of ids)
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return `${ids.length}:${h.toString(36)}`;
}

export function loadLayout(invId: string, ids: string[]): Map<string, [number, number]> | null {
  try {
    const raw = localStorage.getItem(KEY(invId));
    if (!raw) return null;
    const { sig, pos } = JSON.parse(raw) as { sig: string; pos: [number, number][] };
    if (sig !== signature(ids) || pos.length !== ids.length) return null;
    return new Map(ids.map((id, i) => [id, pos[i]!]));
  } catch {
    return null;
  }
}

export function saveLayout(invId: string, ids: string[], get: (id: string) => [number, number]): void {
  try {
    const pos = ids.map((id) => {
      const [x, y] = get(id);
      return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
    });
    localStorage.setItem(KEY(invId), JSON.stringify({ sig: signature(ids), pos }));
  } catch {
    // storage full or unavailable: the layout is simply recomputed next time
  }
}
