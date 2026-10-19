import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FailureReason } from "@voidaccess/engine-client";
import { failureCopy } from "@/content/stages";
import { resetIngest, useNoopIngest } from "@/lib/runs/ingest";
import { startInvestigation } from "@/lib/runs/service";
import { setLauncher } from "@/lib/launcher";
import { StubLauncher, asUser, balanceOf, makeUser, postEvent, waitTerminal } from "./helpers";

// R2b-5 (G5): the runner ends a run whose dark-web sources were unreachable as `failed: sources_unreachable`.
setLauncher(new StubLauncher());
beforeEach(() => useNoopIngest());
afterEach(() => resetIngest());

describe("sources_unreachable", () => {
  it("is a contract failure reason with plain copy for the user", () => {
    expect(FailureReason.options).toContain("sources_unreachable");
    expect(failureCopy("sources_unreachable")).toBe(
      "We couldn't reach the dark-web sources this time, so we stopped the investigation. Your credits were refunded. Please try again in a few minutes.",
    );
  });

  it("fails the run and refunds the charge in full", async () => {
    const u = await makeUser({ credits: 100 });
    asUser(u);
    const { id } = await startInvestigation(u, { query: "unreachable sources", depth: "standard" });
    expect(await balanceOf(u.id)).toBeLessThan(100); // charged at start
    await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    await postEvent(id, 2, { type: "stage", stage: "refine", status: "end" });
    await postEvent(id, 3, { type: "stage", stage: "collect", status: "start" });
    await postEvent(id, 4, { type: "stage", stage: "collect", status: "end" });
    await postEvent(id, 5, {
      type: "failed",
      reason: "sources_unreachable",
      message: "dark-web sources unreachable",
      stages_completed: ["refine", "collect"],
    });
    const run = await waitTerminal(id);
    expect(run.status).toBe("failed");
    expect(run.failureReason).toBe("sources_unreachable");
    expect(await balanceOf(u.id)).toBe(100);
  });
});
