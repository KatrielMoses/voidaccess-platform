import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { RunSpec } from "@voidaccess/engine-client";
import { FIXTURE_NAMES } from "./fixtures";
import { startReceiver } from "./receiver";
import { runMock, type MockMode } from "./run";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "success" },
    "callback-url": { type: "string" },
    secret: { type: "string" },
    "duration-ms": { type: "string", default: "60000" },
    fixture: { type: "string" },
    "bundle-out": { type: "string" },
    query: { type: "string", default: "Cl0p MOVEit ransomware" },
    depth: { type: "string", default: "standard" },
    "run-id": { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`run:mock --mode success|failure|cancel|blocked [--callback-url URL --secret S] [--duration-ms N]
         [--fixture ${FIXTURE_NAMES.join("|")}] [--bundle-out FILE] [--query Q] [--depth quick|standard|deep]
Without --callback-url a local receiver is started and events are printed (demo mode).`);
  process.exit(0);
}

const mode = values.mode as MockMode;
if (!["success", "failure", "cancel", "blocked"].includes(mode)) throw new Error(`bad --mode ${mode}`);
const secret = values.secret ?? process.env.VA_CALLBACK_SECRET ?? "demo-secret-0123456789";
const receiver = values["callback-url"] ? undefined : await startReceiver(secret);
const base = receiver?.url;
const runId = values["run-id"] ?? randomUUID();
const spec: RunSpec = {
  run_id: runId,
  query: values.query!,
  depth: values.depth as RunSpec["depth"],
  callback_url: values["callback-url"] ?? `${base}/callback`,
  callback_secret: secret,
  artifact_put_urls: {
    bundle: base
      ? `${base}/artifacts/bundle.json`
      : `${values["callback-url"]!.replace(/\/[^/]*$/, "")}/bundle.json`,
    exports: {},
  },
  deadline_at: new Date(Date.now() + 15 * 60_000).toISOString(),
};

const ac = new AbortController();
process.on("SIGTERM", () => ac.abort());
process.on("SIGINT", () => ac.abort());

const result = await runMock(spec, {
  mode,
  durationMs: Number(values["duration-ms"]),
  fixture: values.fixture,
  signal: ac.signal,
});
if (receiver) {
  for (const e of receiver.events)
    console.log(
      `#${e.seq} ${e.type}${e.stage ? ` ${e.stage}${e.status ? `:${e.status}` : ""}` : ""}${e.reason ? ` reason=${e.reason}` : ""}${e.message ? ` - ${e.message}` : ""}`,
    );
  console.log(`rejected callbacks: ${receiver.rejected.length}`);
  if (values["bundle-out"] && receiver.artifacts.has("bundle.json"))
    writeFileSync(values["bundle-out"], receiver.artifacts.get("bundle.json")!);
  await receiver.close();
} else if (values["bundle-out"] && result.bundle) {
  writeFileSync(values["bundle-out"], JSON.stringify(result.bundle, null, 1));
}
console.log(
  `terminal: ${result.terminal}${result.reason ? ` (${result.reason})` : ""}, events sent: ${result.eventsSent}`,
);
process.exit(0);
