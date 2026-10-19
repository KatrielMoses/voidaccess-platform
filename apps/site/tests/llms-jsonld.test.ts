import {
  DEPTHS,
  FOUNDING,
  PLANS,
  TOPUP_CREDITS_PER_USD,
  TOPUP_EXPIRY_MONTHS,
  TOPUP_MAX_USD,
  TOPUP_MIN_USD,
  TOPUP_VOLUME_BONUSES,
  topupCredits,
} from "@voidaccess/config";
import { describe, expect, it } from "vitest";
import { facts, resolve, topupExampleAmounts, topupRows, topupTiers } from "@/lib/facts";
import { faqLd, offers, softwareApplicationLd } from "@/lib/jsonld";
import { buildLlmsFull, buildLlmsTxt } from "@/lib/llms";
import { faq } from "@content/pricing";

describe("facts and content tokens", () => {
  it("resolves tokens from config", () => {
    expect(resolve("{{pro.monthly}} / {{pro.credits}}")).toBe(`$${PLANS.pro.monthlyUsd} / ${PLANS.pro.monthlyCredits.toLocaleString("en-US")}`);
    expect(facts.pro.standardRuns).toBe(String(Math.floor(PLANS.pro.monthlyCredits / DEPTHS.standard.credits)));
    expect(facts.pro.monthsFree).toBe("2");
  });
  it("throws on unknown tokens", () => expect(() => resolve("{{nope.x}}")).toThrow());
});

describe("top-up facts come from config", () => {
  const n = (x: number) => x.toLocaleString("en-US");
  it("rule tokens equal config", () => {
    expect(resolve("{{topup.min}}")).toBe(`$${TOPUP_MIN_USD}`);
    expect(resolve("{{topup.max}}")).toBe(`$${TOPUP_MAX_USD}`);
    expect(resolve("{{topup.rate}}")).toBe(n(TOPUP_CREDITS_PER_USD));
    expect(resolve("{{topup.expiryMonths}}")).toBe(String(TOPUP_EXPIRY_MONTHS));
    expect(resolve("{{topup.proBonus}}")).toBe(`${Math.round(PLANS.pro.topupBonus * 100)}%`);
    expect(resolve("{{topup.plusBonus}}")).toBe(`${Math.round(PLANS.pro_plus.topupBonus * 100)}%`);
    const tiers = [...TOPUP_VOLUME_BONUSES].sort((a, b) => a.fromUsd - b.fromUsd);
    tiers.forEach((t, i) => {
      expect(resolve(`{{topup.tier${i + 1}.from}}`)).toBe(`$${t.fromUsd}`);
      expect(resolve(`{{topup.tier${i + 1}.bonus}}`)).toBe(`${Math.round(t.bonus * 100)}%`);
      expect(resolve("{{topup.volume}}")).toContain(`+${Math.round(t.bonus * 100)}% from $${t.fromUsd}`);
    });
    expect(topupTiers().map((t) => t.from)).toEqual(tiers.map((t) => `$${t.fromUsd}`));
  });
  it("the worked example matches topupCredits", () => {
    const top = Math.max(...TOPUP_VOLUME_BONUSES.map((t) => t.fromUsd));
    expect(resolve("{{topup.example.usd}}")).toBe(`$${top}`);
    expect(resolve("{{topup.example.credits}}")).toBe(n(topupCredits(top, "pro")));
  });
  it("example rows span min, every tier and max, with credits from topupCredits per plan", () => {
    const amounts = topupExampleAmounts();
    expect(amounts[0]).toBe(TOPUP_MIN_USD);
    expect(amounts.at(-1)).toBe(TOPUP_MAX_USD);
    for (const t of TOPUP_VOLUME_BONUSES) expect(amounts).toContain(t.fromUsd);
    const rows = topupRows();
    expect(rows.map((x) => x.usd)).toEqual(amounts.map((a) => `$${a}`));
    rows.forEach((row, i) => {
      const a = amounts[i]!;
      expect(row.freeCredits).toBe(n(topupCredits(a, "free")));
      expect(row.proCredits).toBe(n(topupCredits(a, "pro")));
      expect(row.plusCredits).toBe(n(topupCredits(a, "pro_plus")));
    });
  });
});

describe("llms.txt", () => {
  const txt = buildLlmsTxt();
  const full = buildLlmsFull();
  it("states every plan price and credit amount from config", () => {
    for (const p of Object.values(PLANS)) {
      expect(txt).toContain(`${p.monthlyCredits.toLocaleString("en-US")} credits`);
      expect(txt).toContain(`$${p.monthlyUsd}`);
    }
    expect(txt).toContain(`$${FOUNDING.monthlyUsd}/mo`);
    expect(txt).toContain(FOUNDING.copy);
  });
  it("full text states the top-up rule and worked examples from config", () => {
    expect(full).toContain(`from $${TOPUP_MIN_USD} to $${TOPUP_MAX_USD}`);
    expect(full).toContain(`${TOPUP_EXPIRY_MONTHS} months after purchase`);
    for (const row of topupRows()) expect(full).toContain(`${row.usd}: Free ${row.freeCredits} credits, Pro ${row.proCredits} credits, Pro+ ${row.plusCredits} credits`);
    expect(full).not.toMatch(/\{\{/);
  });
  it("never shows Deep", () => {
    expect(txt.toLowerCase()).not.toContain("deep investigation");
    expect(full.toLowerCase()).not.toContain("deep investigation costs");
  });
  it("full text includes policies and the archive disclosure", () => {
    expect(full).toContain("shared, anonymous, dated archive");
    expect(full).toContain("Sexually explicit, pornographic or other NSFW content");
    expect(full).not.toMatch(/\{\{/);
  });
});

describe("JSON-LD", () => {
  it("offers mirror the config", () => {
    const o = offers();
    const prices = o.map((x) => x.price);
    expect(prices).toContain(PLANS.pro.monthlyUsd);
    expect(prices).toContain(PLANS.pro_plus.annualUsd);
    expect(prices).toContain(FOUNDING.monthlyUsd);
    expect(prices).toContain(0);
  });
  it("SoftwareApplication carries the offers", () => expect(softwareApplicationLd().offers.length).toBe(offers().length));
  it("FAQPage resolves tokens", () => {
    const ld = faqLd(faq);
    expect(ld["@type"]).toBe("FAQPage");
    expect(JSON.stringify(ld)).not.toContain("{{");
  });
});
