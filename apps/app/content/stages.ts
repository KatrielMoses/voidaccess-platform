import type { Stage } from "@voidaccess/config";

export const STAGE_LABELS: Record<Stage, { label: string; detail: string }> = {
  refine: { label: "Refine the query", detail: "We expand your search into related queries." },
  collect: { label: "Search sources", detail: "Searching dark-web search engines and indexes." },
  filter: { label: "Filter results", detail: "Dropping duplicates and irrelevant hits." },
  fetch: { label: "Read pages", detail: "Fetching the pages that matter." },
  extract: { label: "Extract entities", detail: "Pulling out actors, indicators and artefacts." },
  enrich: { label: "Enrich", detail: "Cross-checking against what we already know." },
  graph: { label: "Build the graph", detail: "Linking entities to each other." },
  summarize: { label: "Write the summary", detail: "Drafting findings with sources." },
};

export const COUNT_LABELS = [
  ["sources_queried", "Sources searched"],
  ["pages_fetched", "Pages read"],
  ["entities_found", "Entities"],
  ["actors_found", "Actors"],
] as const;

/** Plain-words failure reasons shown to the user. Raw engine errors are never shown. */
export function failureCopy(reason: string | null): string {
  switch (reason) {
    case "blocked_query":
      return "This query matched our Acceptable Use Policy filter, so we didn't run it.";
    case "no_results":
      return "The search finished but found nothing relevant to report.";
    case "deadline":
      return "The investigation took longer than the time limit, so we stopped it.";
    case "cancelled":
      return "The investigation was cancelled.";
    case "sources_unreachable":
      return "We couldn't reach the dark-web sources this time, so we stopped the investigation. Your credits were refunded. Please try again in a few minutes.";
    default:
      return "Something went wrong on our side before we could finish.";
  }
}
