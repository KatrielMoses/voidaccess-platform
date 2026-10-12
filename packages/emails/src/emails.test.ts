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
  it("sends through the log transport", async () => {
    const log = new LogTransport(undefined);
    setTransport(log);
    await sendEmail("passwordReset", "a@b.test", { name: "A", url: "https://x" });
    expect(log.outbox).toHaveLength(1);
    expect(log.outbox[0]).toMatchObject({ to: "a@b.test", template: "passwordReset" });
    setTransport(undefined);
  });
});
