import { Badge } from "@voidaccess/ui";
import { typeStyle } from "@/lib/results/entity-style";

export function TypeBadge({ type }: { type: string }) {
  const s = typeStyle(type);
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
