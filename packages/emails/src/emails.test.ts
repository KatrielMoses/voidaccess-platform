import { describe, expect, it } from "vitest";
import { LogTransport, setTransport, sendEmail, templates } from "./index";

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
});
