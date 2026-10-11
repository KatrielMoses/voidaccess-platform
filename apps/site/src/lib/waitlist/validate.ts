import { z } from "zod";
import type { FirstTouch } from "@voidaccess/db/schema";

const clip = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  clip(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const FIRST_TOUCH_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "referrer",
  "landing_path",
  "ts",
] as const;

/** Keep only known keys with short string values; the client is untrusted. */
export function sanitizeFirstTouch(input: unknown): FirstTouch {
  const out: Record<string, string> = {};
  if (input && typeof input === "object") {
    for (const k of FIRST_TOUCH_KEYS) {
      const v = (input as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
    }
  }
  return out as FirstTouch;
}

export const waitlistInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email())
    .refine((e) => e.split("@")[0]!.length <= 64, "local part too long"),
  role: optional(80),
  useCase: optional(500),
  wantsFounding: z.boolean().default(false),
  consentMarketing: z.boolean().default(false),
  refCode: optional(64),
  firstTouch: z.unknown().optional(),
  turnstileToken: z.string().max(4096).optional(),
  /** honeypot: real users never fill this */
  website: z.string().max(200).optional(),
});

export type WaitlistInput = z.infer<typeof waitlistInput>;
