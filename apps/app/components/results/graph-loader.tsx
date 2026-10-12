"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@voidaccess/ui";

// sigma, graphology and the layout worker only load when the Graph tab is opened
const GraphView = dynamic(() => import("./graph-view").then((m) => m.GraphView), {
  ssr: false,
  loading: () => <Skeleton className="h-[60vh]" />,
});

export function GraphLoader({ investigationId }: { investigationId: string }) {
  return <GraphView investigationId={investigationId} />;
}
