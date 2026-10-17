import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ProgressEvent,
  TraceBatch,
  checkTrace,
  verifyCallback,
  type TraceEvent,
  type VerifyFailure,
} from "@voidaccess/engine-client";

export interface ReceivedBatch {
  /** X-VA-Seq of the batch (must equal its last event's seq). */
  seq: number;
  size: number;
}

export interface Receiver {
  url: string;
  /** Non-trace (progress) events, in arrival order. */
  events: ProgressEvent[];
  /** Contract v2 trace events (from batches), in arrival order, after `checkTrace` (sanitized). */
  traces: TraceEvent[];
  /** Trace batches, in arrival order. */
  batches: ReceivedBatch[];
  /** Every accepted seq (progress and trace), in arrival order. */
  seqLog: number[];
  rejected: { reason: VerifyFailure | "bad_json" | "bad_batch" | "bad_trace" }[];
  artifacts: Map<string, string>;
  close(): Promise<void>;
}

/**
 * Local callback + artifact receiver (node:http). Verifies every callback HMAC; dedupes on (run_id, seq).
 * Accepts single progress events and contract-v2 trace batches (`{schema: 2, run_id, events}`, signed with
 * the last event's seq). Each trace event is checked with `checkTrace`; ignored (unknown) kinds are skipped.
 */
export async function startReceiver(secret: string, port = 0): Promise<Receiver> {
  const events: ProgressEvent[] = [];
  const traces: TraceEvent[] = [];
  const batches: ReceivedBatch[] = [];
  const seqLog: number[] = [];
  const rejected: Receiver["rejected"] = [];
  const artifacts = new Map<string, string>();
  const seen = new Set<string>();
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (req.method === "PUT" && path.startsWith("/artifacts/")) {
        artifacts.set(path.slice("/artifacts/".length), raw.toString("utf8"));
        res.writeHead(200).end();
        return;
      }
      if (req.method === "POST" && path === "/callback") {
        const v = verifyCallback({ secret, headers: req.headers, rawBody: raw });
        if (!v.ok) {
          rejected.push({ reason: v.reason });
          res.writeHead(401).end(v.reason);
          return;
        }
        let body: unknown;
        try {
          body = JSON.parse(raw.toString("utf8") || "null");
        } catch {
          body = null;
        }
        if (body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events)) {
          const b = TraceBatch.safeParse(body);
          const last = b.success ? (b.data.events.at(-1) as { seq?: unknown }) : undefined;
          if (!b.success || b.data.run_id !== v.runId || last?.seq !== v.seq) {
            rejected.push({ reason: "bad_batch" });
            res.writeHead(400).end();
            return;
          }
          const checked = b.data.events.map(checkTrace);
          if (checked.some((c) => !c.ok && !c.ignored)) {
            rejected.push({ reason: "bad_trace" });
            res.writeHead(400).end();
            return;
          }
          batches.push({ seq: v.seq, size: b.data.events.length });
          for (const c of checked) {
            if (!c.ok) continue;
            const key = `${v.runId}:${c.event.seq}`;
            if (seen.has(key)) continue;
            seen.add(key);
            traces.push(c.event);
            seqLog.push(c.event.seq);
          }
          res.writeHead(200).end();
          return;
        }
        const parsed = ProgressEvent.safeParse(body);
        if (!parsed.success) {
          rejected.push({ reason: "bad_json" });
          res.writeHead(400).end();
          return;
        }
        const key = `${v.runId}:${v.seq}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push(parsed.data);
          seqLog.push(parsed.data.seq);
        }
        res.writeHead(200).end();
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    events,
    traces,
    batches,
    seqLog,
    rejected,
    artifacts,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
