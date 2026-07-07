import { supabase } from '@/db/supabase';
import type {
  Contract, AuditResult, Playbook,
  PaginatedResult, DashboardMetrics
} from '@/types/types';

// ─── Playbooks ────────────────────────────────────────────────────────────────

export async function getPlaybooks(): Promise<Playbook[]> {
  const { data, error } = await supabase
    .from('playbooks')
    .select('*')
    .order('is_system', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Array.isArray(data) ? (data as Playbook[]) : [];
}

export async function createPlaybook(
  name: string,
  rules: Playbook['rules_json']
): Promise<void> {
  const { error } = await supabase
    .from('playbooks')
    .insert({ name, rules_json: rules, is_system: false });
  if (error) throw error;
}

export async function updatePlaybook(
  id: string,
  name: string,
  rules: Playbook['rules_json']
): Promise<void> {
  const { error } = await supabase
    .from('playbooks')
    .update({ name, rules_json: rules })
    .eq('id', id);
  if (error) throw error;
}

export async function deletePlaybook(id: string): Promise<void> {
  const { error } = await supabase
    .from('playbooks')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ─── Contracts ────────────────────────────────────────────────────────────────

export async function getContracts(
  page = 1,
  pageSize = 10
): Promise<PaginatedResult<Contract>> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from('contracts')
    .select('*, playbook:playbook_id(id, name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return {
    data: Array.isArray(data) ? (data as Contract[]) : [],
    count: count ?? 0,
    page,
    pageSize,
  };
}

export async function getContractById(id: string): Promise<Contract | null> {
  const { data, error } = await supabase
    .from('contracts')
    .select('*, playbook:playbook_id(id, name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Contract | null;
}

export async function uploadContract(
  file: File,
  playbookId: string | null,
  userId: string
): Promise<Contract> {
  // 1. Upload file to storage
  const fileName = `${userId}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('contracts')
    .upload(fileName, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage
    .from('contracts')
    .getPublicUrl(uploadData.path);

  // 2. Read file text content (for text-based files)
  const fileContent = await extractTextFromFile(file);

  // 3. Insert contract record
  const { data: contractData, error: insertError } = await supabase
    .from('contracts')
    .insert({
      file_name: file.name,
      file_url: urlData.publicUrl,
      file_content: fileContent,
      playbook_id: playbookId || null,
      status: 'uploaded',
    })
    .select()
    .maybeSingle();
  if (insertError) throw insertError;

  return contractData as Contract;
}

async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === 'text/plain') {
    return await file.text();
  }
  // For PDF/DOCX, return filename as placeholder – actual extraction done server-side
  return `[Contract: ${file.name}]\n\nFile uploaded for server-side text extraction and analysis.`;
}

export async function deleteContract(id: string): Promise<void> {
  const { error } = await supabase.from('contracts').delete().eq('id', id);
  if (error) throw error;
}

// ─── Audit Results ────────────────────────────────────────────────────────────

export async function getAuditResults(contractId: string): Promise<AuditResult[]> {
  const { data, error } = await supabase
    .from('audit_results')
    .select('*')
    .eq('contract_id', contractId)
    .order('critical_level', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? (data as AuditResult[]) : [];
}

// ─── Dashboard Metrics ────────────────────────────────────────────────────────

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const { data: completed } = await supabase
    .from('contracts')
    .select('risk_score')
    .eq('status', 'completed');

  const { count: criticalCount } = await supabase
    .from('audit_results')
    .select('*', { count: 'exact', head: true })
    .eq('critical_level', 'high')
    .in('status', ['flagged', 'missing']);

  const completedContracts = Array.isArray(completed) ? completed : [];
  const totalAudited = completedContracts.length;
  const avgScore = totalAudited > 0
    ? Math.round(
        completedContracts.reduce((sum, c) => sum + (c.risk_score ?? 0), 0) / totalAudited
      )
    : 0;

  return {
    totalAudited,
    averageRiskScore: avgScore,
    criticalFlagsPending: criticalCount ?? 0,
  };
}

// ─── Run Audit via Edge Function ──────────────────────────────────────────────

export async function runAudit(contractId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('run-audit', {
    body: { contract_id: contractId },
    method: 'POST',
  });
  if (error) {
    const msg = await error?.context?.text?.();
    throw new Error(msg || error.message);
  }
}
