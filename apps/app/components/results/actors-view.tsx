"use client";

import { useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@voidaccess/ui";
import { formatDate } from "@/lib/results/format";
import type { ActorView } from "@/lib/results/types";
import { SideDrawer } from "./side-drawer";
import { TypeBadge } from "./type-badge";

export function ActorsView({ actors, investigationId }: { actors: ActorView[]; investigationId: string }) {
  const [open, setOpen] = useState<ActorView | null>(null);
  if (actors.length === 0) return <p className="text-fg-secondary">No actors were identified in this run.</p>;
  return (
    <>
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {actors.map((a) => (
          <li key={a.bundleId}>
            <Card className="h-full" data-testid="actor-card">
              <CardHeader>
                <CardTitle className="break-words">{a.handle}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {a.aliases.length > 0 ? (
                  <p className="text-fg-secondary">
                    Also seen as: <span className="text-fg">{a.aliases.join(", ")}</span>
                  </p>
                ) : null}
                <p className="text-fg-secondary">
                  {formatDate(a.firstSeen)} to {formatDate(a.lastSeen)}
                </p>
                <p>
                  <Badge variant="actor">{a.entityCount} linked entities</Badge>
                </p>
                {a.summary ? <p className="text-fg-secondary">{a.summary}</p> : null}
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-auto self-start"
                  onClick={() => setOpen(a)}
                >
                  Details
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <SideDrawer open={open !== null} onClose={() => setOpen(null)} title={open?.handle ?? ""}>
        {open ? (
          <div className="flex flex-col gap-5 text-sm">
            {open.summary ? <p className="text-fg-secondary">{open.summary}</p> : null}
            <section>
              <h3 className="mb-1.5 font-medium">Linked entities ({open.entities.length})</h3>
              <ul className="flex flex-col gap-1.5">
                {open.entities.map((e) => (
                  <li
                    key={e.bundleId}
                    className="flex items-center justify-between gap-2 rounded border border-border-dim bg-surface px-2.5 py-1.5"
                  >
                    <a
                      href={`/investigations/${investigationId}/results/entities?focus=${encodeURIComponent(e.bundleId)}`}
                      className="min-w-0 truncate font-mono text-xs text-accent hover:underline"
                    >
                      {e.displayValue}
                    </a>
                    <TypeBadge type={e.type} />
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1.5 font-medium">Sources ({open.sources.length})</h3>
              <ul className="flex flex-col gap-1">
                {open.sources.map((s) => (
                  <li key={s.bundleId} className="text-fg-secondary">
                    {s.name}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </SideDrawer>
    </>
  );
}
