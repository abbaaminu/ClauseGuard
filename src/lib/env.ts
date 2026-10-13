// Fail-fast validation for frontend build-time env vars (Zod), so a
// misconfigured deployment fails at boot with a clear message instead of
// producing a client that silently can't reach Supabase.
import { z } from 'zod';

const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url({ message: 'VITE_SUPABASE_URL must be a valid URL' }),
  VITE_SUPABASE_ANON_KEY: z.string().min(20, { message: 'VITE_SUPABASE_ANON_KEY looks too short to be valid' }),
  VITE_PADDLE_CLIENT_TOKEN: z.string().min(10).optional(),
  VITE_PADDLE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('production'),
  VITE_PADDLE_STARTER_PRICE_ID: z.string().min(3).optional(),
  VITE_PADDLE_PRO_PRICE_ID: z.string().min(3).optional(),
  // Optional error monitoring; Sentry stays disabled when this is unset.
  VITE_SENTRY_DSN: z.string().url({ message: 'VITE_SENTRY_DSN must be a valid URL' }).optional(),
});

const parsed = EnvSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // Throwing here intentionally halts app boot rather than letting the app
  // render with a broken Supabase client and fail confusingly later.
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCheck your .env against .env.example.`);
}

export const env = parsed.data;
