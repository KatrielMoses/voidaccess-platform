import { describe, expect, it } from "vitest";
import { LogTransport, TEMPLATE_CATEGORY, setTransport, sendEmail, templates } from "./index";

describe("emails", () => {
  it("renders plain-text templates with the link and signature", () => {
    const t = templates.verifyEmail({ name: "Ada", url: "https://app.test/verify?t=1" });
    expect(t.text).toContain("Hi Ada");
    expect(t.text).toContain("https://app.test/verify?t=1");
    expect(t.subject).toMatch(/Confirm/);
    expect(templates.magicLink({ url: "u", minutes: 5 }).text).toContain("5 minutes");
  });
  it("renders the billing templates with every placeholder filled", () => {
    const out = [
      templates.welcomePro({ name: "A", plan: "Pro", credits: "N", url: "u", billingUrl: "b" }),
      templates.creditAlert80({ name: "A", pct: "80", balance: "5", billingUrl: "b", expiryMonths: "12" }),
      templates.creditAlert100({ name: "A", resetDate: "d", billingUrl: "b", expiryMonths: "12" }),
      templates.foundingReleaseWarning({
        name: "A",
        date: "d",
        reason: "r",
        nextPlan: "Pro",
        howToKeep: "h",
        foundingPrice: "p",
        termMonths: "t",
        renewalMonths: "r",
        inactivityMonths: "i",
        billingUrl: "b",
      }),
      templates.foundingReleased({ name: "A", reason: "r", whatHappensNext: "w", billingUrl: "b" }),
      templates.cancellationSurvey({ name: "A", date: "d" }),
      templates.paymentFailed({ name: "A", portalUrl: "p" }),
    ];
    for (const t of out) {
      expect(t.text).not.toMatch(/\{\{/);
      expect(t.subject).not.toMatch(/\{\{/);
    }
    expect(out[5]!.subject).toBe("What made you leave?");
  });
  it("sends through the log transport", async () => {
    const log = new LogTransport(undefined);
    setTransport(log);
    await sendEmail("passwordReset", "a@b.test", { name: "A", url: "https://x" });
    expect(log.outbox).toHaveLength(1);
    expect(log.outbox[0]).toMatchObject({ to: "a@b.test", template: "passwordReset" });
    setTransport(undefined);
  });
  it("lifecycle templates are founder-signed, carry the unsubscribe link, and fill every placeholder", () => {
    const u = "https://app.test/unsubscribe?u=1&t=2";
    const out = [
      templates.welcome({
        name: "A",
        url: "https://app.test/investigations/new",
        freeCredits: "100",
        unsubscribeUrl: u,
      }),
      templates.firstInvestigationNudge({
        name: "A",
        url: "https://app.test/n",
        example: "q",
        unsubscribeUrl: u,
      }),
      templates.whatNext({
        name: "A",
        url: "https://app.test/n",
        billingUrl: "b",
        unsubscribeUrl: u,
      }),
    ];
    for (const t of out) {
      expect(t.text).not.toMatch(/\{\{/);
      expect(t.text).toContain(u);
      expect(t.text).toContain("— Katriel");
    }
    expect(out[0]!.text).toContain("LockBit ransomware group"); // the three example queries
  });
  it("every template is classified, and a lifecycle email cannot be sent without a one-click unsubscribe", async () => {
    expect(Object.keys(TEMPLATE_CATEGORY).sort()).toEqual(Object.keys(templates).sort());
    const log = new LogTransport(undefined);
    setTransport(log);
    const p = { name: "A", url: "u", freeCredits: "1", unsubscribeUrl: "x" };
    await expect(sendEmail("welcome", "a@b.test", p)).rejects.toThrow(/lifecycle/);
    await sendEmail("welcome", "a@b.test", p, { oneClickUrl: "https://app.test/api/unsubscribe?u=1&t=2" });
    expect(log.outbox[0]!.headers).toEqual({
      "List-Unsubscribe": "<https://app.test/api/unsubscribe?u=1&t=2>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    // transactional email never carries unsubscribe headers
    await sendEmail("passwordReset", "a@b.test", { name: "A", url: "https://x" });
    expect(log.outbox[1]!.headers).toBeUndefined();
    setTransport(undefined);
  });
});
