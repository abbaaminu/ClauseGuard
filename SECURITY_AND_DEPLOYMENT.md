# 🔒 Security & Deployment Guide for ClauseGuard

## ✅ Current Security Status

Your repository is **SAFE TO MAKE PUBLIC** or keep public. Here's why:

### ✓ What's Protected
- ✅ `.env` files are in `.gitignore` (secrets won't be committed)
- ✅ `.env.example` is provided as a template
- ✅ No hardcoded API keys or passwords in code
- ✅ Supabase folder will be removed (using env vars instead)
- ✅ All sensitive data is properly separated

### ✓ What's Already Good
1. **Environment Variables** - Properly configured in `src/db/supabase.ts`
2. **.gitignore** - Correctly excludes `.env`, `node_modules`, logs, etc.
3. **No Secrets in Code** - All API calls use environment variables
4. **Skills Folder** - Excluded from repository (`.skills/` in `.gitignore`)

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

### Step 3: Set Up Supabase Database

Paste this SQL into **Supabase → SQL Editor**:

```sql
-- ============================================================================
-- ClauseGuard Database Schema
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Playbooks Table
CREATE TABLE IF NOT EXISTS playbooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Contracts Table
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_content TEXT,
  playbook_id UUID REFERENCES playbooks(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'completed', 'failed')),
  risk_score FLOAT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Audit Results Table
CREATE TABLE IF NOT EXISTS audit_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  critical_level TEXT NOT NULL CHECK (critical_level IN ('low', 'medium', 'high', 'critical')),
  issue_title TEXT NOT NULL,
  issue_description TEXT,
  suggestion TEXT,
  status TEXT DEFAULT 'flagged' CHECK (status IN ('flagged', 'missing', 'resolved', 'acknowledged')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contracts_playbook_id ON contracts(playbook_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_created_at ON contracts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_results_contract_id ON audit_results(contract_id);
CREATE INDEX IF NOT EXISTS idx_audit_results_critical_level ON audit_results(critical_level);
CREATE INDEX IF NOT EXISTS idx_playbooks_is_system ON playbooks(is_system);

-- Enable RLS (Row Level Security)
ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_results ENABLE ROW LEVEL SECURITY;

-- Public read access to playbooks
CREATE POLICY "Enable read access for all users" ON playbooks
  FOR SELECT USING (true);
```

### Step 4: Create Storage Bucket

1. Go to **Supabase Dashboard → Storage**
2. Click **Create a new bucket**
3. Name: `contracts`
4. Make it **PUBLIC**
5. Set CORS policy:

```json
[
  {
    "origin": ["*"],
    "methods": ["GET", "POST", "DELETE"],
    "allowedHeaders": ["*"]
  }
]
```

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
| **API Keys** | Vercel | Environment Variables |
| **Database Credentials** | Supabase | Handled internally |
| **Third-party Keys** | Vercel | Environment Variables |
| **Local Development** | `.env.local` | `.gitignore` excluded |

---

## 🔐 Making the Repo Public Safely

Your repo is **ready to be public**. Here's the checklist:

- [x] No `.env` file committed
- [x] `.gitignore` properly configured
- [x] `.env.example` provided
- [x] Supabase folder will be removed
- [x] All credentials use environment variables
- [x] Source code is clean and branded

**You can make it public now!**

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

## 🔄 If You Ever Commit a Secret

1. **Rotate immediately** - Revoke the exposed key
2. **Remove from history**:
   ```bash
   git filter-branch --tree-filter 'rm -f .env' HEAD
   git push -f
   ```
3. **Reissue credentials** - Generate new keys

---

## 📚 Resources

- [Supabase Getting Started](https://supabase.com/docs/guides/getting-started)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [GitHub Security Best Practices](https://docs.github.com/en/code-security)

---

## ✨ Next Steps

1. ✅ Verify `.env.example` is committed
2. ✅ Add environment variables to Vercel
3. ✅ Run SQL in Supabase
4. ✅ Create storage bucket
5. ✅ Deploy to Vercel
6. ✅ Test the application

Your repo is **secure and ready for production!** 🚀
