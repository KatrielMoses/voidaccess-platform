import { FOUNDING, PLANS } from "@voidaccess/config";
import { money, resolve, topupRows } from "./facts";
import { abs, GITHUB_URL, SITE_NAME } from "./site";
import * as home from "@content/home";
import * as pricing from "@content/pricing";
import * as features from "@content/features";
import * as trust from "@content/trust";
import * as terms from "@content/terms";
import * as privacy from "@content/privacy";
import * as aup from "@content/acceptable-use";
import type { LegalPage, Section } from "@content/types";

const r = resolve;

function planLines(): string[] {
  return Object.values(PLANS).map((p) => {
    const price =
      p.monthlyUsd === 0
        ? money(0)
        : p.id === FOUNDING.plan
          ? `${money(FOUNDING.monthlyUsd)}/mo founding price for the first ${FOUNDING.seats} subscribers, then ${money(p.monthlyUsd)}/mo`
          : `${money(p.monthlyUsd)}/mo`;
    const bits = [price, `${p.monthlyCredits.toLocaleString("en-US")} credits per month`];
    if (p.annualUsd !== null) bits.push(`${money(p.annualUsd)}/yr billed annually`);
    bits.push(p.historyDays === null ? "unlimited history" : `${p.historyDays}-day history`);
    bits.push(p.requiresCard ? "card required" : "no card");
    const feats = p.features
      .filter((f) => f !== "deep" && f !== "history_unlimited")
      .map((f) => pricing.featureLabels[f]?.label + (pricing.featureLabels[f]?.soon ? " (after launch)" : ""))
      .filter(Boolean);
    return `- **${p.name}**: ${bits.join("; ")}. Features: ${feats.join("; ")}.`;
  });
}

function topupLines(): string[] {
  return [
    r("- Any whole-dollar amount from {{topup.min}} to {{topup.max}}, at {{topup.rate}} credits per dollar."),
    r("- Volume bonus: {{topup.volume}} (the highest tier reached applies)."),
    r("- Subscriber bonus on top of the volume bonus: +{{topup.proBonus}} on Pro, +{{topup.plusBonus}} on Pro+."),
    "- Worked examples:",
    ...topupRows().map(
      (t) => `  - ${t.usd}: Free ${t.freeCredits} credits, Pro ${t.proCredits} credits, Pro+ ${t.plusCredits} credits (volume bonus ${t.volumeBonus})`,
    ),
  ];
}

function sections(list: Section[]): string[] {
  return list.flatMap((s) => [`### ${s.heading}`, ...(s.paragraphs ?? []).map((x) => r(x)), ...(s.bullets ?? []).map((b) => `- ${r(b)}`), ""]);
}

function legal(p: LegalPage): string[] {
  return [`## ${p.title}`, r(p.intro), "", ...sections(p.sections)];
}

/** /llms.txt: a short, link-first summary (llmstxt.org format). Built from content + config at build time. */
export function buildLlmsTxt(): string {
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${r(home.meta.description)}`,
    "",
    r(pricing.founding.lead),
    "",
    "## Product",
    `- [Home](${abs("/")}): ${r(home.hero.title)}`,
    `- [Features](${abs("/features")}): the eight pipeline stages, entity types, enrichment, exports, AI search and the archive`,
    `- [Open source](${abs("/open-source")}): the MIT-licensed engine, free to self-host (${GITHUB_URL})`,
    "",
    "## Pricing",
    ...planLines(),
    `- A Quick investigation costs ${r("{{depth.quick}}")} credits; a Standard investigation costs ${r("{{depth.standard}}")} credits. Failed or cancelled runs are refunded.`,
    `- Founding offer: ${r("{{founding.price}}")}/mo for the first ${r("{{founding.seats}}")} paid Pro subscribers. ${r("{{founding.copy}}")}`,
    `- [Pricing details](${abs("/pricing")})`,
    "",
    "## Policies",
    `- [Trust](${abs("/trust")}): safety, data handling, the shared anonymous archive, responsible disclosure`,
    `- [Terms (draft)](${abs("/terms")})`,
    `- [Privacy (draft)](${abs("/privacy")})`,
    `- [Acceptable use (draft)](${abs("/acceptable-use")})`,
    "",
    "## Optional",
    `- [Full text for LLMs](${abs("/llms-full.txt")})`,
    `- [Join the waitlist](${abs("/waitlist")})`,
    "",
  ].join("\n");
}

/** /llms-full.txt: the same facts with full text of the main pages and policies. */
export function buildLlmsFull(): string {
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${r(home.meta.description)}`,
    "",
    "## What it is",
    r(home.hero.sub),
    "",
    ...home.pillars.map((p) => `- **${p.name}**: ${r(p.body)}`),
    "",
    "## How it works",
    ...home.steps.map((s, i) => `${i + 1}. **${s.title}**: ${r(s.body)}`),
    "",
    "## Pricing",
    r(pricing.hero.sub),
    "",
    ...planLines(),
    "",
    `Top-ups (all plans, including Free; credits expire ${r("{{topup.expiryMonths}}")} months after purchase):`,
    ...topupLines(),
    "",
    `Credits: ${r(pricing.explainer.example)} ${pricing.explainer.rules.map((x) => r(x)).join(" ")}`,
    "",
    `### Founding seats: ${r(pricing.founding.title)}`,
    ...pricing.founding.rules.map((x) => `- ${r(x)}`),
    "",
    "### Pricing FAQ",
    ...pricing.faq.flatMap((f) => [`**${r(f.q)}** ${r(f.a)}`, ""]),
    "## Features",
    ...features.stages.map((s, i) => `${i + 1}. **${s.name}**: ${s.body}`),
    "",
    "Entity types:",
    ...features.entityTypes.map((e) => `- ${e.category}: ${e.examples}`),
    "",
    ...sections([features.enrichment, features.aiSearch, features.archive]),
    "Exports:",
    ...features.exportsSection.formats.map((f) => `- ${f.name} (${f.note})`),
    "",
    "## Trust",
    ...sections(trust.sections),
    `Security contact: ${trust.contact.security}`,
    "",
    "## FAQ",
    ...home.faq.flatMap((f) => [`**${r(f.q)}** ${r(f.a)}`, ""]),
    ...legal(terms.page),
    ...legal(privacy.page),
    ...legal(aup.page),
  ].join("\n");
}
