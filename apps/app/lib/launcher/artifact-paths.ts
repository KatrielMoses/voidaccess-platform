/**
 * Where a run's artifacts live in the runs bucket: gs://<bucket>/runs/<run_id>/<name>.
 * The runner (runner/cloud) is given these as `artifact_put_urls` and uploads with its own identity; the app reads
 * them back with artifacts-gcs.ts. One module so the writer and the readers can never disagree.
 */
import { EXPORT_KINDS, type ExportKind } from "@voidaccess/engine-client";
import { getEnv } from "../../env";

export const BUNDLE_NAME = "bundle.json";
export const PAGES_NAME = "pages.jsonl.gz";

/** Object name per export format. */
export const EXPORT_FILE: Record<ExportKind, string> = {
  stix: "stix.json",
  misp: "misp.json",
  sigma: "sigma.yml",
  yara: "yara.yar",
  snort: "snort.rules",
  suricata: "suricata.rules",
};

export const runsBucket = () => getEnv().RUNS_BUCKET;
export const objectName = (runId: string, name: string) => `runs/${runId}/${name}`;
export const gsUrl = (runId: string, name: string) => `gs://${runsBucket()}/${objectName(runId, name)}`;

/** `artifact_put_urls` for the Cloud Run launcher: the bundle, every export format and the page archive. */
export function gcsArtifactUrls(runId: string) {
  return {
    bundle: gsUrl(runId, BUNDLE_NAME),
    exports: Object.fromEntries(EXPORT_KINDS.map((k) => [k, gsUrl(runId, EXPORT_FILE[k])])) as Record<
      ExportKind,
      string
    >,
    pages: gsUrl(runId, PAGES_NAME),
  };
}
