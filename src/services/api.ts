import { supabase } from '@/db/supabase';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  Contract, AuditResult, Playbook, AuditUsage, ContractVersion,
  PaginatedResult, DashboardMetrics
} from '@/types/types';

const MAX_CONTRACT_TEXT_CHARS = 100_000;

/** Matches the contract_id validation performed by the `run-audit` function. */
const CONTRACT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isContractId(value: string): boolean {
  return CONTRACT_ID_PATTERN.test(value);
}

// ─── Playbooks ────────────────────────────────────────────────────────────────

export async function getPlaybooks(): Promise<Playbook[]> {
  const { data, error } = await supabase
    .from('playbooks')
    .select('*')
    .order('is_system', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Array.isArray(data)
    ? (data as Playbook[]).map(playbook => ({
        ...playbook,
        rules_json: playbook.rules_json.map(rule => ({ ...rule, weight: rule.weight ?? 1 })),
      }))
    : [];
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

export async function createOrganizationInvite(): Promise<string> {
  const { data, error } = await supabase.rpc('create_organization_invite', {
    p_valid_days: 7,
    p_max_uses: 10,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('The organization invite could not be created.');
  return data;
}

export async function getAuditUsage(): Promise<AuditUsage> {
  const { data, error } = await supabase.rpc('get_audit_usage');
  if (error) throw error;
  if (!data || typeof data !== 'object' || !('plan_tier' in data)) {
    throw new Error('Audit usage information was not returned.');
  }
  return data as AuditUsage;
}

export async function getPaddleCheckoutContext(): Promise<{
  organization_id: string;
  organization_signature: string;
}> {
  const { data, error } = await supabase.functions.invoke('paddle-checkout-context', {
    method: 'POST',
    body: {},
  });
  if (error) throw error;
  if (
    !data
    || typeof data.organization_id !== 'string'
    || typeof data.organization_signature !== 'string'
  ) {
    throw new Error('Paddle checkout organization could not be verified.');
  }
  return {
    organization_id: data.organization_id,
    organization_signature: data.organization_signature,
  };
}

export async function changePaddlePlan(tier: 'starter' | 'pro'): Promise<void> {
  const { data, error } = await supabase.functions.invoke('change-paddle-plan', {
    method: 'POST',
    body: { tier },
  });
  if (error) throw error;
  if (!data || data.updated !== true || data.tier !== tier) {
    throw new Error('Paddle did not confirm the plan change.');
  }
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
    .select('*, playbook:playbooks!contracts_playbook_id_fkey(id, name)', { count: 'exact' })
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
  // Guard malformed route params (e.g. /contracts/abc): a non-UUID would reach
  // Postgres and surface as a 22P02 error instead of a clean "not found".
  if (!isContractId(id)) return null;

  const { data, error } = await supabase
    .from('contracts')
    .select('*, playbook:playbooks!contracts_playbook_id_fkey(id, name)')
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
  // The id is interpolated into a Realtime filter, so anything that is not a
  // UUID must be rejected before it can be read as filter syntax.
  if (!isContractId(contractId)) {
    console.warn('subscribeToContract: ignored a non-UUID contract id');
    return () => {};
  }

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
    throw new Error('No selectable text was found in this document. Scanned PDFs need OCR before they can be audited.');
  }
  if (fileContent.length > MAX_CONTRACT_TEXT_CHARS) {
    throw new Error(`Extracted document text exceeds the ${MAX_CONTRACT_TEXT_CHARS.toLocaleString()}-character audit limit.`);
  }

  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${organizationId}/${crypto.randomUUID()}_${safeFileName}`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('contracts')
    .upload(storagePath, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  try {
    const { data: contractData, error: insertError } = await supabase.rpc('create_contract_for_audit', {
      p_file_name: file.name,
      p_file_url: uploadData.path,
      p_file_content: fileContent,
      p_playbook_id: playbookId,
    });

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

export async function extractTextFromFile(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();
  if (file.type === 'text/plain' || lowerName.endsWith('.txt')) {
    return await file.text();
  }
  if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
    const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorkerUrl }] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    let loadingTask: ReturnType<typeof getDocument> | null = null;
    try {
      loadingTask = getDocument({ data: await file.arrayBuffer() });
      const document: PDFDocumentProxy = await loadingTask.promise;
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
        page.cleanup();
        if (pages.join('\n').length > MAX_CONTRACT_TEXT_CHARS) break;
      }
      return pages.join('\n').trim();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown PDF parsing error.';
      throw new Error(`Could not extract text from this PDF. ${detail}`);
    } finally {
      if (loadingTask) await loadingTask.destroy();
    }
  }
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx')
  ) {
    try {
      const { default: mammoth } = await import('mammoth/mammoth.browser');
      const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return value.trim();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown DOCX parsing error.';
      throw new Error(`Could not extract text from this DOCX file. ${detail}`);
    }
  }
  throw new Error('Unsupported document format. Upload a .txt, .pdf, or .docx file.');
}

export async function getContractVersions(contractId: string): Promise<ContractVersion[]> {
  const { data, error } = await supabase
    .from('contract_versions')
    .select('*')
    .eq('contract_id', contractId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Array.isArray(data) ? data as ContractVersion[] : [];
}

export async function addContractVersion(
  contract: Contract,
  file: File
): Promise<ContractVersion> {
  const fileContent = await extractTextFromFile(file);
  if (!fileContent.trim()) {
    throw new Error('No selectable text was found in this revision. Scanned PDFs need OCR before they can be compared.');
  }
  if (fileContent.length > MAX_CONTRACT_TEXT_CHARS) {
    throw new Error(`Extracted document text exceeds the ${MAX_CONTRACT_TEXT_CHARS.toLocaleString()}-character comparison limit.`);
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Sign in to save a contract revision.');

  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${contract.organization_id}/${crypto.randomUUID()}_${safeFileName}`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('contract-versions')
    .upload(storagePath, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  try {
    const { data, error } = await supabase
      .from('contract_versions')
      .insert({
        contract_id: contract.id,
        organization_id: contract.organization_id,
        user_id: user.id,
        file_name: file.name,
        file_url: uploadData.path,
        file_content: fileContent,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as ContractVersion;
  } catch (error) {
    const { error: cleanupError } = await supabase.storage.from('contract-versions').remove([uploadData.path]);
    if (cleanupError) console.error('Failed to remove orphaned contract revision:', cleanupError);
    throw error;
  }
}

export async function deleteContract(id: string): Promise<void> {
  const { data: contract, error: lookupError } = await supabase
    .from('contracts')
    .select('file_url')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!contract) return;

  const { data: versions, error: versionsError } = await supabase
    .from('contract_versions')
    .select('file_url')
    .eq('contract_id', id);
  if (versionsError) throw versionsError;

  const { error: deleteError } = await supabase.from('contracts').delete().eq('id', id);
  if (deleteError) throw deleteError;

  const storagePaths = [contract.file_url, ...(versions ?? []).map(version => version.file_url)]
    .filter(path => path && !/^https?:\/\//i.test(path));
  if (contract.file_url && storagePaths.includes(contract.file_url)) {
    const { error: storageError } = await supabase.storage
      .from('contracts')
      .remove([contract.file_url]);
    if (storageError) console.error('Failed to remove deleted contract file:', storageError);
  }
  const versionPaths = (versions ?? []).map(version => version.file_url)
    .filter(path => path && !/^https?:\/\//i.test(path));
  if (versionPaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from('contract-versions')
      .remove(versionPaths);
    if (storageError) console.error('Failed to remove deleted contract revisions:', storageError);
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

export async function runAudit(contractId: string): Promise<{ warning?: string }> {
  const { data, error } = await supabase.functions.invoke('run-audit', {
    body: { contract_id: contractId },
    method: 'POST',
  });
  if (error) {
    let message = error.message || 'The audit request failed. Check your connection and try again.';
    try {
      const responseText = await error.context?.text?.();
      if (responseText) {
        const responseBody: unknown = JSON.parse(responseText);
        if (
          typeof responseBody === 'object' &&
          responseBody !== null &&
          'error' in responseBody &&
          typeof responseBody.error === 'string'
        ) {
          message = responseBody.error;
        }
      }
    } catch (responseError) {
      console.warn('Failed to read run-audit error response:', responseError);
    }
    throw new Error(message);
  }

  if (
    typeof data === 'object' && data !== null && 'warning' in data &&
    typeof data.warning === 'string'
  ) {
    return { warning: data.warning };
  }
  return {};
}
