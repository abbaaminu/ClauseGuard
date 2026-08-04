
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Contract status enum
CREATE TYPE contract_status AS ENUM ('uploaded', 'processing', 'completed', 'failed');

-- Audit result status enum
CREATE TYPE audit_status AS ENUM ('passed', 'flagged', 'missing');

-- Critical level enum
CREATE TYPE critical_level AS ENUM ('low', 'medium', 'high');

-- Profiles table
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  organization_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Playbooks table (user_id nullable for system playbooks)
CREATE TABLE playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  rules_json jsonb NOT NULL DEFAULT '[]',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Contracts table
CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL DEFAULT '',
  file_content text NOT NULL DEFAULT '',
  playbook_id uuid REFERENCES playbooks(id) ON DELETE SET NULL,
  status contract_status NOT NULL DEFAULT 'uploaded',
  risk_score integer CHECK (risk_score >= 0 AND risk_score <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Audit results table
CREATE TABLE audit_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  category text NOT NULL,
  status audit_status NOT NULL,
  critical_level critical_level NOT NULL DEFAULT 'low',
  contract_snippet text NOT NULL DEFAULT '',
  alternative_suggestion text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Storage bucket for contracts
INSERT INTO storage.buckets (id, name, public) VALUES ('contracts', 'contracts', false);

-- RLS Policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_results ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Playbooks policies
CREATE POLICY "Users can view own and system playbooks" ON playbooks FOR SELECT USING (auth.uid() = user_id OR is_system = true);
CREATE POLICY "Anon can view system playbooks" ON playbooks FOR SELECT TO anon USING (is_system = true);
CREATE POLICY "Users can insert own playbooks" ON playbooks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own playbooks" ON playbooks FOR UPDATE USING (auth.uid() = user_id AND is_system = false);
CREATE POLICY "Users can delete own playbooks" ON playbooks FOR DELETE USING (auth.uid() = user_id AND is_system = false);

-- Contracts policies
CREATE POLICY "Users can view own contracts" ON contracts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own contracts" ON contracts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contracts" ON contracts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contracts" ON contracts FOR DELETE USING (auth.uid() = user_id);

-- Audit results policies
CREATE POLICY "Users can view audit results for own contracts" ON audit_results 
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM contracts WHERE contracts.id = audit_results.contract_id AND contracts.user_id = auth.uid())
  );
CREATE POLICY "Service role can insert audit results" ON audit_results 
  FOR INSERT WITH CHECK (true);

-- Storage policies for contracts bucket
CREATE POLICY "Users can upload own contracts" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contracts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can view own contracts files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'contracts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can delete own contracts files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'contracts' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Auto-create profile on signup trigger
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, organization_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'organization_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Seed system playbooks (user_id = null for system entries)
INSERT INTO playbooks (id, user_id, name, rules_json, is_system)
VALUES 
  (gen_random_uuid(), NULL, 'GDPR Compliance Checklist', 
   '[
     {"id": "gdpr-1", "title": "Data Processing Agreement", "description": "Contract must include explicit data processing agreement per GDPR Article 28", "severity": "high"},
     {"id": "gdpr-2", "title": "Right to Erasure", "description": "Contract must address data subject right to erasure per GDPR Article 17", "severity": "high"},
     {"id": "gdpr-3", "title": "Data Breach Notification", "description": "Contract must specify data breach notification obligations within 72 hours", "severity": "high"},
     {"id": "gdpr-4", "title": "Data Transfer Restrictions", "description": "Contract must address restrictions on international data transfers outside EEA", "severity": "medium"},
     {"id": "gdpr-5", "title": "Privacy by Design", "description": "Contract should reference privacy by design and default principles", "severity": "medium"},
     {"id": "gdpr-6", "title": "Purpose Limitation", "description": "Data collection must be limited to specified, explicit, and legitimate purposes", "severity": "high"}
   ]'::jsonb, true),
  (gen_random_uuid(), NULL, 'Standard Vendor NDA Guidelines', 
   '[
     {"id": "nda-1", "title": "Definition of Confidential Information", "description": "NDA must clearly define what constitutes confidential information", "severity": "high"},
     {"id": "nda-2", "title": "Duration of Obligations", "description": "NDA must specify the duration of confidentiality obligations (typically 2-5 years)", "severity": "medium"},
     {"id": "nda-3", "title": "Governing Law", "description": "Governing law must strictly be the state of Delaware. Flag any other jurisdiction.", "severity": "high"},
     {"id": "nda-4", "title": "Return of Materials", "description": "NDA must include obligation to return or destroy confidential materials upon request", "severity": "medium"},
     {"id": "nda-5", "title": "Exclusions from Confidentiality", "description": "NDA must list standard exclusions (publicly known info, independently developed, etc.)", "severity": "low"},
     {"id": "nda-6", "title": "Non-Solicitation Clause", "description": "Contract should address non-solicitation of employees during and after engagement", "severity": "low"}
   ]'::jsonb, true),
  (gen_random_uuid(), NULL, 'Enterprise SaaS Agreement Template', 
   '[
     {"id": "saas-1", "title": "Indemnification Clause", "description": "Contract must include mutual indemnification provisions protecting both parties", "severity": "high"},
     {"id": "saas-2", "title": "Limitation of Liability", "description": "Liability cap must be specified, typically limited to fees paid in prior 12 months", "severity": "high"},
     {"id": "saas-3", "title": "SLA and Uptime Guarantee", "description": "Contract must specify minimum SLA (e.g., 99.9% uptime) and remedies for breach", "severity": "medium"},
     {"id": "saas-4", "title": "Termination for Convenience", "description": "Both parties should have termination for convenience rights with notice period", "severity": "medium"},
     {"id": "saas-5", "title": "Intellectual Property Ownership", "description": "Contract must clearly define IP ownership of pre-existing and created materials", "severity": "high"},
     {"id": "saas-6", "title": "Data Portability on Termination", "description": "Customer must retain right to export their data within 30 days of termination", "severity": "medium"}
   ]'::jsonb, true),
  (gen_random_uuid(), NULL, 'Employment Contract Compliance', 
   '[
     {"id": "emp-1", "title": "At-Will Employment Clause", "description": "Contract must clearly state at-will employment status for US employees", "severity": "high"},
     {"id": "emp-2", "title": "Non-Compete Restrictions", "description": "Non-compete clause must be reasonable in scope, duration (max 1 year), and geography", "severity": "high"},
     {"id": "emp-3", "title": "Intellectual Property Assignment", "description": "Employee must assign all work-product IP to employer, with carve-outs for personal projects", "severity": "high"},
     {"id": "emp-4", "title": "Dispute Resolution", "description": "Contract should specify arbitration or mediation for dispute resolution", "severity": "medium"},
     {"id": "emp-5", "title": "Benefits Summary", "description": "Contract must reference the benefits package and eligibility requirements", "severity": "low"}
   ]'::jsonb, true);
