import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { ProgressEvent, RunSpec, STAGES, isTerminalEvent, verifyCallback } from "./engine-client/src/index.ts";

interface PlanItem {
  id: string;
  query: string;
  depth: "quick" | "standard" | "deep";
  /** Minutes from the first spec fetch; negative = already expired. Default 30. */
  deadlineMinutes?: number;
  label?: string;
}

const ROOT = process.env.CALLBACK_ROOT!;
const PUBLIC_URL = process.env.PUBLIC_URL!;
const BUCKET = process.env.RUNS_BUCKET ?? "voidaccess-cloud-runs";
const PLAN = new Map((JSON.parse(process.env.PLAN_JSON!) as PlanItem[]).map((p) => [p.id, p]));
const hm = (label: string, id: string) => createHmac("sha256", ROOT).update(`${label}:${id}`).digest("hex");

interface RunLog {
  specServed: number;
  events: { seq: number; type: string; stage?: string; status?: string; stage_index?: number; at: string; receivedAt: number; duration_ms?: number; counts?: unknown; reason?: string; stages_completed?: string[]; metrics?: unknown; message?: string }[];
  duplicateSeqs: number[];
  rejected: { reason: string; seq?: string }[];
  invalid: string[];
}
const runs = new Map<string, RunLog>();
const log = (id: string) => {
  let r = runs.get(id);
  if (!r) runs.set(id, (r = { specServed: 0, events: [], duplicateSeqs: [], rejected: [], invalid: [] }));
  return r;
};
const used = new Set<string>();
const say = (o: Record<string, unknown>) => console.log(JSON.stringify(o));

function report() {
  const out: Record<string, unknown> = {};
  for (const [id, p] of PLAN) {
    const r = runs.get(id);
    if (!r) {
      out[id] = { label: p.label, depth: p.depth, seen: false };
      continue;
    }
    const seqs = r.events.map((e) => e.seq).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < seqs.length; i++) for (let s = seqs[i - 1]! + 1; s < seqs[i]!; s++) gaps.push(s);
    const terminals = r.events.filter((e) => isTerminalEvent(e as never));
    const stageEvents = r.events.filter((e) => e.type === "stage");
    const stageOrderOk = stageEvents.every((e, i) => {
      const idx = e.stage_index ?? 0;
      const prev = i > 0 ? (stageEvents[i - 1]!.stage_index ?? 0) : 0;
      return idx >= prev && STAGES.indexOf(e.stage as never) + 1 === idx;
    });
    const startedBeforeEnded = STAGES.every((s) => {
      const st = stageEvents.findIndex((e) => e.stage === s && e.status === "start");
      const en = stageEvents.findIndex((e) => e.stage === s && e.status !== "start");
      return st === -1 ? en === -1 : en === -1 || st < en;
    });
    out[id] = {
      label: p.label,
      depth: p.depth,
      seen: true,
      specServed: r.specServed,
      events: r.events.length,
      firstSeq: seqs[0],
      lastSeq: seqs.at(-1),
      gaps,
      duplicateSeqs: r.duplicateSeqs,
      rejected: r.rejected,
      invalid: r.invalid,
      arrivalOrderIsSeqOrder: r.events.every((e, i) => i === 0 || e.seq > r.events[i - 1]!.seq),
      stageOrderOk,
      startedBeforeEnded,
      typesSeen: [...new Set(r.events.map((e) => e.type))],
      stagesStarted: stageEvents.filter((e) => e.status === "start").map((e) => e.stage),
      stagesEnded: stageEvents.filter((e) => e.status === "end" || e.status === "skipped").map((e) => e.stage),
      terminalCount: terminals.length,
      terminal: terminals[0] ?? null,
      lastCounts: [...r.events].reverse().find((e) => e.counts)?.counts ?? null,
      firstAt: r.events[0]?.at,
      lastAt: r.events.at(-1)?.at,
    };
  }
  return out;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", PUBLIC_URL);
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method === "GET" && url.pathname === "/report") return send(200, report());
    if (req.method === "GET" && url.pathname === "/healthz") return send(200, { ok: true });

    const m = /^\/api\/engine\/runs\/([^/]+)\/(spec|events)$/.exec(url.pathname);
    if (!m) return send(404, { error: "not found" });
    const id = m[1]!;
    const plan = PLAN.get(id);
    if (!plan) return send(404, { error: "not found" });

    if (m[2] === "spec" && req.method === "GET") {
      const token = url.searchParams.get("t") ?? "";
      if (token !== hm("spec", id) || used.has(id)) {
        say({ evt: "spec_refused", run: id });
        return send(404, { error: "not found" });
      }
      used.add(id);
      log(id).specServed += 1;
      const base = `gs://${BUCKET}/runs/${id}`;
      const spec = RunSpec.parse({
        run_id: id,
        query: plan.query,
        depth: plan.depth,
        callback_url: `${PUBLIC_URL}/api/engine/runs/${id}/events`,
        callback_secret: hm("callback", id),
        artifact_put_urls: {
          bundle: `${base}/bundle.json`,
          exports: {
            stix: `${base}/stix.json`,
            misp: `${base}/misp.json`,
            sigma: `${base}/sigma.yml`,
            yara: `${base}/yara.yar`,
            snort: `${base}/snort.rules`,
            suricata: `${base}/suricata.rules`,
          },
          pages: `${base}/pages.jsonl.gz`,
        },
        deadline_at: new Date(Date.now() + (plan.deadlineMinutes ?? 30) * 60_000).toISOString(),
      });
      say({ evt: "spec_served", run: id });
      return send(200, spec);
    }

    if (m[2] === "events" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const r = log(id);
      const v = verifyCallback({ secret: hm("callback", id), headers: req.headers as never, rawBody: raw });
      if (!v.ok) {
        r.rejected.push({ reason: v.reason, seq: String(req.headers["x-va-seq"] ?? "") });
        say({ evt: "cb_rejected", run: id, reason: v.reason });
        return send(401, { error: "unauthorized" });
      }
      const parsed = ProgressEvent.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.run_id !== id || parsed.data.seq !== v.seq) {
        r.invalid.push(parsed.success ? "header/body mismatch" : parsed.error.issues[0]?.path.join(".") + ": " + parsed.error.issues[0]?.message);
        say({ evt: "cb_invalid", run: id, seq: v.seq });
        return send(400, { error: "invalid event" });
      }
      const e = parsed.data;
      if (r.events.some((x) => x.seq === e.seq)) {
        r.duplicateSeqs.push(e.seq);
        return send(200, { ok: true, result: "duplicate" });
      }
      r.events.push({
        seq: e.seq, type: e.type, stage: e.stage, status: e.status, stage_index: e.stage_index, at: e.at,
        receivedAt: Date.now(), duration_ms: e.duration_ms, counts: e.counts, reason: e.reason,
        stages_completed: e.stages_completed, metrics: e.metrics, message: e.message,
      });
      say({ evt: "cb", run: id, seq: e.seq, type: e.type, stage: e.stage, status: e.status, reason: e.reason });
      return send(200, { ok: true, result: "recorded" });
    }
    return send(405, { error: "method" });
  } catch (err) {
    say({ evt: "error", message: err instanceof Error ? err.message : "error" });
    return send(500, { error: "internal" });
  }
});
server.listen(Number(process.env.PORT ?? 8080), () => say({ evt: "listening", runs: [...PLAN.keys()].length }));
