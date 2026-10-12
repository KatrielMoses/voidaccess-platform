/** Typed errors for the run lifecycle. Routes map these to HTTP via lib/runs/http.ts. */
export type RunErrorCode =
  | "invalid_query"
  | "depth_unavailable"
  | "unverified_email"
  | "account_inactive"
  | "insufficient_credits"
  | "rate_limited_concurrent"
  | "rate_limited_daily"
  | "not_found"
  | "not_terminal"
  | "not_cancellable"
  | "invalid_body"
  | "csrf";

const STATUS: Record<RunErrorCode, number> = {
  invalid_query: 400,
  depth_unavailable: 400,
  invalid_body: 400,
  unverified_email: 403,
  account_inactive: 403,
  csrf: 403,
  insufficient_credits: 402,
  rate_limited_concurrent: 429,
  rate_limited_daily: 429,
  not_found: 404,
  not_terminal: 409,
  not_cancellable: 409,
};

export class RunError extends Error {
  readonly status: number;
  constructor(
    public readonly code: RunErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RunError";
    this.status = STATUS[code];
  }
}
