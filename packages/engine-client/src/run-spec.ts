import { z } from "zod";
import { Depth } from "./entities";

export const EXPORT_KINDS = ["stix", "misp", "sigma", "yara", "snort", "suricata"] as const;
export const ExportKind = z.enum(EXPORT_KINDS);
export type ExportKind = z.infer<typeof ExportKind>;

export const RunSpec = z.object({
  run_id: z.string().min(1),
  query: z.string().min(1),
  depth: Depth,
  callback_url: z.url(),
  /** Per-run HMAC key. */
  callback_secret: z.string().min(16),
  artifact_put_urls: z.object({
    bundle: z.url(),
    exports: z.partialRecord(ExportKind, z.url()),
    /** pages.jsonl.gz: the sanitized page archive input (lane P4). Optional so older specs stay valid. */
    pages: z.url().optional(),
  }),
  /** ISO. The job must finish and emit `failed` reason "deadline" by then. */
  deadline_at: z.iso.datetime({ offset: true }),
});
export type RunSpec = z.infer<typeof RunSpec>;
