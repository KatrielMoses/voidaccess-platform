import Link from "next/link";
import type { RelevanceView, Tier } from "@/lib/results/types";

/**
 * Relevance tiers (contract v0.4, engine 2.2) in the design.md language: no hue, no fills. Direct reads at full paper,
 * Related at dim, Background at mute and collapsed. Every item collected stays visible; the tiers only say how it
 * relates to the query.
 */

export const TIER_LABEL: Record<Tier, string> = {
  direct: "Direct",
  related: "Related",
  background: "Background",
};

/** One line under each section heading. `q` is the user's own query. */
export function tierHelp(tier: Tier, q: string, what: "entities" | "sources"): string {
  if (tier === "direct")
    return what === "entities"
      ? `Names “${q}” itself, or appears right next to a mention of it.`
      : `The page mentions “${q}”: the name, the selector or a known alias.`;
  if (tier === "related")
    return what === "entities"
      ? `Doesn’t name “${q}”, but was found on a page that does, or on a related page.`
      : `Doesn’t mention “${q}”, but matches part of it, a known relation or a search term.`;
  return what === "entities"
    ? `On the pages this run reached, but nothing ties it to “${q}”. Kept so nothing is hidden.`
    : `Reached by this run, but doesn’t mention “${q}”. Kept so nothing is hidden.`;
}

/** The Background heading's subtitle: the label the brief asked for. */
export const BACKGROUND_SUBTITLE = "collected, not about your query";

/** True when nothing collected mentions the query directly (no Direct page and no Direct value). */
export function directIsEmpty(r: RelevanceView | null): boolean {
  return Boolean(r) && r!.pages.direct === 0 && r!.entities.direct === 0;
}

/** The honest notice shown at the top of every results tab when Direct is empty. */
export function NoDirectNotice({ query, relevance }: { query: string; relevance: RelevanceView }) {
  const collected = relevance.pages.related + relevance.pages.background;
  return (
    <div
      role="note"
      data-testid="no-direct-notice"
      className="border-l border-line-3 pl-4 text-[15px] text-dim"
    >
      <p>
        <span className="font-medium text-paper">Nothing collected mentions “{query}” directly. </span>
        {collected > 0
          ? `This run reached ${collected} ${collected === 1 ? "page" : "pages"}, but none of them names your query, so nothing below is a finding about it. It is kept, labelled Related or Background, so you can judge it yourself.`
          : "Nothing below is a finding about your query."}
        {relevance.filterFallback
          ? " The AI relevance filter returned nothing usable for this run, so every search result was kept unfiltered."
          : ""}
      </p>
    </div>
  );
}

/** A mono tier word for rows and detail panels: paper, dim or mute (never a colour). */
export function TierWord({ tier, reason }: { tier: Tier; reason?: string | null }) {
  const tone = tier === "direct" ? "text-paper" : tier === "related" ? "text-dim" : "text-mute";
  return (
    <span
      className={`font-mono text-[12px] whitespace-nowrap ${tone}`}
      title={reason ? `${TIER_LABEL[tier]}: ${reason}` : TIER_LABEL[tier]}
      data-testid={`relevance-${tier}`}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

/** A section heading with its count and its one-line explanation. */
export function TierHeading({
  tier,
  count,
  help,
  id,
}: {
  tier: Tier;
  count: number;
  help: string;
  id: string;
}) {
  const bg = tier === "background";
  return (
    <div className="flex flex-col gap-1.5">
      <h2
        id={id}
        className={`flex flex-wrap items-baseline gap-x-3 text-[22px] leading-tight font-medium tracking-[-0.02em] ${bg ? "text-dim" : "text-paper"}`}
      >
        {TIER_LABEL[tier]}
        {bg ? (
          <span className="text-[15px] font-normal tracking-normal text-mute">{BACKGROUND_SUBTITLE}</span>
        ) : null}
        <span
          className="font-mono text-[13px] font-normal tracking-normal text-mute tabular-nums"
          data-testid={`tier-count-${tier}`}
        >
          {count}
        </span>
      </h2>
      <p className={`text-[14px] ${bg ? "text-mute" : "text-dim"}`}>{help}</p>
    </div>
  );
}

/** Summary tab: what the run collected per tier, and the few things the engine left out (counts only). */
export function RelevancePanel({ id, relevance }: { id: string; relevance: RelevanceView }) {
  const notes: string[] = [];
  const { removed } = relevance;
  if (removed.gazetteerContext > 0)
    notes.push(
      `${removed.gazetteerContext} threat-name ${removed.gazetteerContext === 1 ? "match was" : "matches were"} dropped because the word was used in its everyday sense.`,
    );
  if (removed.orgBoilerplate > 0)
    notes.push(
      `${removed.orgBoilerplate} ${removed.orgBoilerplate === 1 ? "organisation was" : "organisations were"} dropped as a page’s own site, publisher or platform name.`,
    );
  if (relevance.feedItemsCapped > 0)
    notes.push(
      `${relevance.feedItemsCapped} recent feed ${relevance.feedItemsCapped === 1 ? "article" : "articles"} that matched nothing in your query ${relevance.feedItemsCapped === 1 ? "was" : "were"} left out.`,
    );
  if (relevance.refinedQueryRestored)
    notes.push("The AI rewrite of your query lost a key term, so your original query was searched instead.");
  if (relevance.filterFallback)
    notes.push(
      "The AI relevance filter returned nothing usable, so every search result was kept unfiltered.",
    );
  return (
    <section aria-labelledby="relevance-h" className="flex flex-col gap-4" data-testid="relevance-panel">
      <h2 id="relevance-h" className="text-[22px] leading-tight font-medium tracking-[-0.025em]">
        Relevance to your query
      </h2>
      <dl className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-3">
        {(["direct", "related", "background"] as const).map((t) => (
          <div key={t} className="flex flex-col gap-3 bg-bg px-5 py-5">
            <dt
              className={`font-mono text-[12px] ${t === "direct" ? "text-paper" : t === "related" ? "text-dim" : "text-mute"}`}
            >
              {TIER_LABEL[t]}
              {t === "background" ? ` · ${BACKGROUND_SUBTITLE}` : ""}
            </dt>
            <dd className="flex flex-col gap-1 font-mono text-[13px] text-dim tabular-nums">
              <Link
                href={`/investigations/${id}/results/entities`}
                className={`text-[24px] leading-none tracking-[-0.04em] ${t === "background" ? "text-dim" : "text-paper"}`}
                data-testid={`relevance-entities-${t}`}
              >
                {relevance.entities[t]}
              </Link>
              <span>
                {relevance.entities[t] === 1 ? "entity" : "entities"} · {relevance.pages[t]}{" "}
                {relevance.pages[t] === 1 ? "source" : "sources"}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {notes.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-[14px] text-dim">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
