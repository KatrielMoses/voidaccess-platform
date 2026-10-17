"use client";

import dynamic from "next/dynamic";

// sigma, graphology and the layout worker only load when the graph opens
const Workspace = dynamic(() => import("./workspace/workspace").then((m) => m.Workspace), {
  ssr: false,
  loading: () => <div className="h-[calc(100dvh-16rem)]" aria-busy />,
});

export function GraphLoader({ investigationId }: { investigationId: string }) {
  return <Workspace investigationId={investigationId} />;
}
