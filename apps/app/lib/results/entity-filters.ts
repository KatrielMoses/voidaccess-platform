import type { EntitySort } from "./types";

/** Entity-table filters as they live in the URL (shareable within the same account). */
export interface EntityFilters {
  q: string;
  types: string[];
  min: number | null;
  max: number | null;
  sensitive: boolean;
  sort: EntitySort;
  dir: "asc" | "desc";
  focus: string | null;
}

export const DEFAULT_SORT: { sort: EntitySort; dir: "asc" | "desc" } = { sort: "confidence", dir: "desc" };
const SORTS: EntitySort[] = ["value", "type", "confidence", "firstSeen", "sources", "degree"];

export function parseFilters(sp: URLSearchParams): EntityFilters {
  const n = (k: string) => {
    const v = sp.get(k);
    return v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
  };
  const sort = sp.get("sort") as EntitySort | null;
  return {
    q: sp.get("q") ?? "",
    types: sp.get("types")?.split(",").filter(Boolean) ?? [],
    min: n("min"),
    max: n("max"),
    sensitive: sp.get("sensitive") === "1",
    sort: sort && SORTS.includes(sort) ? sort : DEFAULT_SORT.sort,
    dir: sp.get("dir") === "asc" ? "asc" : sp.get("dir") === "desc" ? "desc" : DEFAULT_SORT.dir,
    focus: sp.get("focus"),
  };
}

/** Serialise to a query string, omitting defaults so URLs stay short. */
export function filtersToParams(f: EntityFilters, includeFocus = true): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.types.length) p.set("types", f.types.join(","));
  if (f.min !== null) p.set("min", String(f.min));
  if (f.max !== null) p.set("max", String(f.max));
  if (f.sensitive) p.set("sensitive", "1");
  if (f.sort !== DEFAULT_SORT.sort || f.dir !== DEFAULT_SORT.dir) {
    p.set("sort", f.sort);
    p.set("dir", f.dir);
  }
  if (includeFocus && f.focus) p.set("focus", f.focus);
  return p;
}

export function toggleSort(f: EntityFilters, col: EntitySort): EntityFilters {
  if (f.sort === col) return { ...f, dir: f.dir === "asc" ? "desc" : "asc" };
  return {
    ...f,
    sort: col,
    dir: col === "confidence" || col === "degree" || col === "sources" ? "desc" : "asc",
  };
}

export function toggleType(f: EntityFilters, type: string): EntityFilters {
  return { ...f, types: f.types.includes(type) ? f.types.filter((t) => t !== type) : [...f.types, type] };
}
