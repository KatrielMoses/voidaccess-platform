export type IngestFailure =
  | "not_found" // no investigation for this run id
  | "bundle_unreadable" // deps.readBundle threw
  | "invalid_bundle" // fails the ResultBundle schema
  | "integrity" // dangling ids inside the bundle
  | "too_large" // beyond the sanity cap
  | "write_failed"; // the transaction failed; nothing was written

/** Thrown by ingestBundle. P2 marks the run failed and refunds on any IngestError. */
export class IngestError extends Error {
  constructor(
    readonly reason: IngestFailure,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "IngestError";
  }
}
