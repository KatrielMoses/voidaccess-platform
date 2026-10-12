import { describe, expect, it } from "vitest";
import { firstTouchPayload } from "@/lib/auth/first-touch";

const touch = { utm_source: "hn", utm_campaign: "launch", ref: "abc", landing_path: "/", ts: "2026-10-12T00:00:00.000Z", referrer: "news.ycombinator.com" };

describe("firstTouchPayload", () => {
  it("sends nothing without consent", () => {
    expect(firstTouchPayload(touch, null)).toBeUndefined();
    expect(firstTouchPayload(touch, "denied")).toBeUndefined();
  });
  it("sends only utm, ref, landing and time after consent (no referrer host)", () => {
    expect(firstTouchPayload(touch, "granted")).toEqual({ utm: { utm_source: "hn", utm_campaign: "launch" }, ref: "abc", landing: "/", at: "2026-10-12T00:00:00.000Z" });
  });
  it("sends nothing when nothing was captured", () => {
    expect(firstTouchPayload({}, "granted")).toBeUndefined();
  });
});
