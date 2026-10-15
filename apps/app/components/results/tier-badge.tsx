import { Tooltip } from "@voidaccess/ui";
import { archiveCopy } from "@/lib/archive/copy";

type Tier = "unconfirmed" | "corroborated" | "feed_validated";
/** Strength is a 3-step instrument reading (like the pipeline ruler), not a colour. */
const STEPS: Record<Tier, number> = { unconfirmed: 1, corroborated: 2, feed_validated: 3 };

export function TierBadge({ tier }: { tier: Tier }) {
  const n = STEPS[tier];
  return (
    <Tooltip content={archiveCopy.tierHelp[tier]}>
      <span
        tabIndex={0}
        className={`inline-flex items-center gap-1.5 rounded-xs font-mono text-[12px] leading-none whitespace-nowrap ${n === 3 ? "text-paper" : n === 2 ? "text-dim" : "text-mute"}`}
        data-testid={`tier-${tier}`}
      >
        <span aria-hidden className="flex items-end gap-[2px]">
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className={`w-[2px] ${i <= n ? "bg-current" : "bg-line-2"}`}
              style={{ height: 4 + i * 2 }}
            />
          ))}
        </span>
        {archiveCopy.tierLabel[tier]}
      </span>
    </Tooltip>
  );
}
