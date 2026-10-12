import { Badge, type BadgeVariant } from "@voidaccess/ui";

const MAP: Record<string, { label: string; variant: BadgeVariant }> = {
  reserved: { label: "Queued", variant: "accent" },
  launching: { label: "Starting", variant: "accent" },
  running: { label: "Running", variant: "accent" },
  ingesting: { label: "Finishing", variant: "accent" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  cancelled: { label: "Cancelled", variant: "neutral" },
};

export function StatusBadge({ status }: { status: string }) {
  const m = MAP[status] ?? { label: status, variant: "default" as BadgeVariant };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
