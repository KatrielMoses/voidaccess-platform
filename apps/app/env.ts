import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Optional in dev; health reports db "unconfigured" without it. */
  DATABASE_URL: z.string().min(1).optional(),
  APP_URL: z.url().default("http://localhost:3000"),
  /** Build/commit identifier, injected at image build time. */
  APP_VERSION: z.string().min(1).default("0.0.0"),
  COMMIT_SHA: z.string().min(1).default("dev"),
});

export type Env = z.infer<typeof envSchema>;

/** Parse an env-like object; throws a readable error on invalid values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as unset so blank vars in .env files don't fail validation.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily validated process env; nothing is read at import/build time. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
