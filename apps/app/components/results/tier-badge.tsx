import { Badge, Tooltip } from "@voidaccess/ui";
import { archiveCopy } from "@/lib/archive/copy";

type Tier = "unconfirmed" | "corroborated" | "feed_validated";
const VARIANT = { unconfirmed: "neutral", corroborated: "accent", feed_validated: "success" } as const;

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <Tooltip content={archiveCopy.tierHelp[tier]}>
      <span tabIndex={0} className="inline-flex" data-testid={`tier-${tier}`}>
        <Badge variant={VARIANT[tier]}>{archiveCopy.tierLabel[tier]}</Badge>
      </span>
    </Tooltip>
  );
}
