# ClauseGuard Security and Deployment

## Security Model

- Contract rows and files are private and scoped to the authenticated user's organization by Supabase RLS.
- The `contracts` storage bucket must remain private. Do not enable public access or add broad `storage.objects` policies.
- The browser uses only the Supabase URL and anon key. Never expose the service-role key or Google API keys to the frontend.
- `run-audit` validates the caller and checks access to the contract through the user's RLS-scoped client before using its service-role client.
- The audit function allows wildcard CORS for browser access, but CORS is not authorization; a valid user token and tenant-visible contract are still required.

Review the active migrations and deployment environment before making any claim that a deployment or repository is safe for production or public release.

---

## 🚀 Setup Instructions for Vercel Deployment

### Step 1: Get Supabase Credentials

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Create a new project or use existing one
3. Navigate to **Settings → API**
4. Copy these values:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **Anon Public Key** (starts with `eyJhbGci...`)

### Step 2: Add Environment Variables to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your ClauseGuard project
3. Click **Settings → Environment Variables**
4. Add these variables:

```
VITE_SUPABASE_URL = https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> **Note:** These values are public-safe (anon key is meant for client-side use)

Set the AI provider key only as a Supabase Edge Function secret, never as a Vercel/browser variable. Configure it with `supabase secrets set GOOGLE_API_KEY=... REDACT_PII_BEFORE_LLM=true ALLOW_MOCK_AUDITS=false`. Supabase provides its URL and anon/service-role keys to deployed Edge Functions; do not copy the service-role key into frontend configuration. Mock results are disabled by default and must only be explicitly enabled in isolated development environments.

### Step 3: Apply the database schema

Use the checked-in Supabase migrations as the only source of truth. From the repository root, link the Supabase project and apply migrations with the Supabase CLI (`supabase link`, then `supabase db push`). Do not paste an alternate schema into the SQL Editor: the migrations implement organization-level tenancy, required `organization_id` values, RLS, and storage policies.

### Step 4: Configure private contract storage

Migration `00001_initial_clauseguard_schema.sql` creates the `contracts` bucket as private. Migration `00002_multi_tenancy_and_rls_hardening.sql` restricts object access to the caller's organization folder. Do not recreate the bucket as public or replace these policies with wildcard access.

---

## 🛡️ Security Best Practices

### What NOT to Commit
- ❌ `.env` files (actual credentials)
- ❌ Private API keys
- ❌ Database passwords
- ❌ JWT secrets
- ❌ Personal information
- ❌ Payment card data

### What SHOULD be in Repo
- ✅ `.env.example` (template with placeholders)
- ✅ Configuration files (without secrets)
- ✅ Source code
- ✅ Documentation

### Where to Put Secrets

| Type | Location | Method |
|------|----------|--------|
| **Browser Supabase URL and anon key** | Vercel | Environment Variables |
| **Google API key** | Supabase Edge Functions | `supabase secrets set` |
| **Database Credentials** | Supabase | Handled internally |
| **Local Development** | `.env.local` | `.gitignore` excluded |

---

## 📋 For Local Development

Create a local `.env.local` file (git-ignored):

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

Then run:
```bash
npm install
npm run dev
```

---

## If a Secret Is Exposed

Revoke or rotate it immediately, check provider logs for misuse, and notify affected stakeholders. Removing a secret from the current commit does not remove it from Git history; coordinate history rewriting with repository owners and rotate the credential regardless.

---

## 📚 Resources

- [Supabase Getting Started](https://supabase.com/docs/guides/getting-started)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [GitHub Security Best Practices](https://docs.github.com/en/code-security)

---

## ✨ Next Steps

1. Apply the checked-in migrations with `supabase db push`.
2. Configure the browser variables in Vercel and the AI key as an Edge Function secret.
3. Verify the contract bucket remains private and run the RLS tests.
4. Confirm document text extraction is implemented for each format enabled in the upload UI before enabling production audits.
5. Deploy and verify authentication, cross-organization isolation, and audit failure behavior.
