/** Export format catalogue (pure data, safe to import from client components). */
export const BASE_FORMATS = ["csv", "json"] as const; // available on every plan
export const GATED_FORMATS = ["markdown", "ioc"] as const; // generated, plan-gated (export_all)
export const ARTIFACT_FORMATS = ["stix", "misp", "sigma", "yara", "snort", "suricata"] as const; // runner artifacts, plan-gated
export const ALL_FORMATS = [...BASE_FORMATS, ...GATED_FORMATS, ...ARTIFACT_FORMATS] as const;
export type ExportFormat = (typeof ALL_FORMATS)[number];

export const isFormat = (f: string): f is ExportFormat => (ALL_FORMATS as readonly string[]).includes(f);
export const isGated = (f: ExportFormat) => f !== "csv" && f !== "json";
export const isArtifact = (f: ExportFormat): f is (typeof ARTIFACT_FORMATS)[number] =>
  (ARTIFACT_FORMATS as readonly string[]).includes(f);

export const FORMAT_META: Record<
  ExportFormat,
  { label: string; ext: string; mime: string; description: string }
> = {
  csv: {
    label: "CSV",
    ext: "zip",
    mime: "application/zip",
    description: "Entities, relationships and sources as three CSV files in a ZIP",
  },
  json: {
    label: "JSON",
    ext: "json",
    mime: "application/json",
    description: "The full snapshot: summary, entities, relationships, actors, sources",
  },
  markdown: {
    label: "Markdown report",
    ext: "md",
    mime: "text/markdown; charset=utf-8",
    description: "A readable report: summary, key findings, entities by type, actors, sources",
  },
  ioc: {
    label: "IOC package",
    ext: "zip",
    mime: "application/zip",
    description: "Indicator lists by type (CSV and TXT), sensitive values masked",
  },
  stix: {
    label: "STIX 2.1",
    ext: "json",
    mime: "application/json",
    description: "STIX 2.1 bundle from the run",
  },
  misp: { label: "MISP", ext: "json", mime: "application/json", description: "MISP event from the run" },
  sigma: {
    label: "Sigma",
    ext: "yml",
    mime: "text/plain; charset=utf-8",
    description: "Sigma rules where the run produced them",
  },
  yara: {
    label: "YARA",
    ext: "yar",
    mime: "text/plain; charset=utf-8",
    description: "YARA rules where the run produced them",
  },
  snort: {
    label: "Snort",
    ext: "rules",
    mime: "text/plain; charset=utf-8",
    description: "Snort rules where the run produced them",
  },
  suricata: {
    label: "Suricata",
    ext: "rules",
    mime: "text/plain; charset=utf-8",
    description: "Suricata rules where the run produced them",
  },
};

export function exportFilename(invId: string, format: ExportFormat): string {
  return `voidaccess-${invId.slice(0, 8)}-${format}.${FORMAT_META[format].ext}`;
}

export interface ExportState {
  format: ExportFormat;
  /** the plan lacks export_all */
  locked: boolean;
  /** an artifact format the run did not produce */
  missing: boolean;
}

export function exportStates(opts: { exportAll: boolean; artifacts: string[] }): ExportState[] {
  return ALL_FORMATS.map((format) => {
    const gated = format !== "csv" && format !== "json";
    const isArtifact = !["csv", "json", "markdown", "ioc"].includes(format);
    return {
      format,
      locked: gated && !opts.exportAll,
      missing: isArtifact && !opts.artifacts.includes(format),
    };
  });
}
