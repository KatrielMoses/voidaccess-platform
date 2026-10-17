import type { Stage } from "@voidaccess/config";
import type { LiveModel } from "@/lib/live/model";

/** Short stage names for the instrument's columns (sentence case, mono indices beside them). */
export const STAGE_SHORT: Record<Stage, string> = {
  refine: "Refine",
  collect: "Collect",
  filter: "Filter",
  fetch: "Fetch",
  extract: "Extract",
  enrich: "Enrich",
  graph: "Graph",
  summarize: "Summarize",
};

const n = (v: number) => v.toLocaleString("en-US");

/** The one number per stage under its column head; trace counts, or the progress counts when traces are off. */
export function stageStat(m: LiveModel, s: Stage, done: boolean): string {
  const c = m.counts;
  switch (s) {
    case "refine": {
      const q = m.queries.filter(Boolean).length;
      return q ? `${q} ${q === 1 ? "query" : "queries"}` : "";
    }
    case "collect": {
      const found = Math.max(m.found, c.results_found ?? 0);
      return found ? `${n(found)} links` : "";
    }
    case "filter":
      return m.kept || m.discarded ? `${n(m.kept)} kept` : "";
    case "fetch": {
      const read = m.pagesRead();
      return read ? `${n(read)} read` : "";
    }
    case "extract": {
      const e = m.pageEntities();
      return e ? `${n(e)} entities` : "";
    }
    case "enrich":
      return m.enrich.size ? `${m.enrich.size} sources` : "";
    case "graph": {
      const nodes = m.graph?.nodes ?? m.entities.size;
      const edges = m.graph?.edges ?? m.edges.length;
      return nodes ? `${n(nodes)} · ${n(edges)}` : "";
    }
    case "summarize":
      if (m.terminal === "completed" || (done && m.stages.summarize === "end")) return "written";
      return m.stages.summarize === "start" || m.summary ? "writing" : "";
  }
}
