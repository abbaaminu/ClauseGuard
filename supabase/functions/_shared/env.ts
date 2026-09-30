// Fail-fast environment validation for edge functions.
// Import { env } from "../_shared/env.ts" and every downstream usage gets a
// typed, guaranteed-present value instead of `Deno.env.get(...)!` landmines.
import { z } from "npm:zod@3.25.76";

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  GOOGLE_API_KEY: z.string().min(10).optional(),
  // Escalation model for the cascade (see schemas.ts). Optional: falls back
  // to the fast model if unset, but should be set in production.
  GOOGLE_API_KEY_ESCALATION: z.string().min(10).optional(),
  ALLOW_MOCK_AUDITS: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  // Toggle for the PII redaction pass — should be "true" in every
  // environment that isn't a local/dev sandbox with synthetic data.
  REDACT_PII_BEFORE_LLM: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const raw = {
    SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    GOOGLE_API_KEY: Deno.env.get("GOOGLE_API_KEY"),
    GOOGLE_API_KEY_ESCALATION: Deno.env.get("GOOGLE_API_KEY_ESCALATION"),
    ALLOW_MOCK_AUDITS: Deno.env.get("ALLOW_MOCK_AUDITS"),
    REDACT_PII_BEFORE_LLM: Deno.env.get("REDACT_PII_BEFORE_LLM"),
  };
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    // Never leak secret *values* in the error — only which keys are missing/invalid.
    const issues = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid/missing environment variables: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
