import { DEPTHS, FOUNDING, PLANS } from "@voidaccess/config";
import { describe, expect, it } from "vitest";
import { facts, resolve } from "@/lib/facts";
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
