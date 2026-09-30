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

export type ContractStatusUpdate = Pick<Contract, 'id' | 'status' | 'risk_score'>;

export function subscribeToContract(
  contractId: string,
  onUpdate: (update: ContractStatusUpdate) => void
): () => void {
  const channel = supabase
    .channel(`contract-status:${contractId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'contracts',
        filter: `id=eq.${contractId}`,
      },
      (payload) => onUpdate(payload.new as ContractStatusUpdate)
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function uploadContract(
  file: File,
  playbookId: string | null,
  organizationId: string
): Promise<Contract> {
  const fileContent = await extractTextFromFile(file);
  if (!fileContent.trim()) {
    throw new Error('Only plain-text .txt files can be analyzed until PDF/DOCX extraction is available.');
  }

  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${organizationId}/${crypto.randomUUID()}_${safeFileName}`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('contracts')
    .upload(storagePath, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  try {
    const { data: contractData, error: insertError } = await supabase
      .from('contracts')
      .insert({
        file_name: file.name,
        file_url: uploadData.path,
        file_content: fileContent,
        organization_id: organizationId,
        playbook_id: playbookId,
        status: 'uploaded',
      })
      .select()
      .maybeSingle();

    if (insertError) throw insertError;
    if (!contractData) throw new Error('Contract record was not created');
    return contractData as Contract;
  } catch (error) {
    try {
      const { error: cleanupError } = await supabase.storage
        .from('contracts')
        .remove([uploadData.path]);
      if (cleanupError) console.error('Failed to remove orphaned contract upload:', cleanupError);
    } catch (cleanupError) {
      console.error('Failed to remove orphaned contract upload:', cleanupError);
    }
    throw error;
  }

}

async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
    return await file.text();
  }
  return '';
}

export async function deleteContract(id: string): Promise<void> {
  const { data: contract, error: lookupError } = await supabase
    .from('contracts')
    .select('file_url')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!contract) return;

  const { error: deleteError } = await supabase.from('contracts').delete().eq('id', id);
  if (deleteError) throw deleteError;

  if (contract.file_url && !/^https?:\/\//i.test(contract.file_url)) {
    const { error: storageError } = await supabase.storage
      .from('contracts')
      .remove([contract.file_url]);
    if (storageError) console.error('Failed to remove deleted contract file:', storageError);
  }
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
  const [completedResult, criticalResult] = await Promise.all([
    supabase
      .from('contracts')
      .select('risk_score')
      .eq('status', 'completed'),
    supabase
      .from('audit_results')
      .select('id', { count: 'exact', head: true })
      .eq('critical_level', 'high')
      .in('status', ['flagged', 'missing']),
  ]);

  if (completedResult.error) throw completedResult.error;
  if (criticalResult.error) throw criticalResult.error;

  const completedContracts = completedResult.data ?? [];
  const totalAudited = completedContracts.length;
  const avgScore = totalAudited > 0
    ? Math.round(
        completedContracts.reduce((sum, c) => sum + (c.risk_score ?? 0), 0) / totalAudited
      )
    : 0;

  return {
    totalAudited,
    averageRiskScore: avgScore,
    criticalFlagsPending: criticalResult.count ?? 0,
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
