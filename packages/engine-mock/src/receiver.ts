import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ProgressEvent, verifyCallback, type VerifyFailure } from "@voidaccess/engine-client";

export interface Receiver {
  url: string;
  events: ProgressEvent[];
  rejected: { reason: VerifyFailure | "bad_json" }[];
  artifacts: Map<string, string>;
  close(): Promise<void>;
}

/** Local callback + artifact receiver (node:http). Verifies every callback HMAC; dedupes on (run_id, seq). */
export async function startReceiver(secret: string, port = 0): Promise<Receiver> {
  const events: ProgressEvent[] = [];
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
        const parsed = ProgressEvent.safeParse(JSON.parse(raw.toString("utf8") || "null"));
        if (!parsed.success) {
          rejected.push({ reason: "bad_json" });
          res.writeHead(400).end();
          return;
        }
        const key = `${v.runId}:${v.seq}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push(parsed.data);
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
    rejected,
    artifacts,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
