// ClauseGuard – shared TypeScript types

export type ContractStatus = 'uploaded' | 'processing' | 'completed' | 'failed';
export type AuditStatus = 'passed' | 'flagged' | 'missing';
export type CriticalLevel = 'low' | 'medium' | 'high';

export interface Profile {
  id: string;
  email: string;
  organization_name: string;
  organization_id: string;
  created_at: string;
}

export interface PlaybookRule {
  id: string;
  title: string;
  description: string;
  severity: CriticalLevel;
  weight: number;
}

export interface Playbook {
  id: string;
  user_id: string | null;
  name: string;
  rules_json: PlaybookRule[];
  is_system: boolean;
  created_at: string;
}

export interface Contract {
  id: string;
  user_id: string;
  organization_id: string;
  file_name: string;
  /** Object path in the private contracts storage bucket. */
  file_url: string;
  file_content: string;
  playbook_id: string | null;
  status: ContractStatus;
  risk_score: number | null;
  created_at: string;
  playbook?: Pick<Playbook, 'id' | 'name'> | null;
}

export interface AuditResult {
  id: string;
  contract_id: string;
  category: string;
  status: AuditStatus;
  critical_level: CriticalLevel;
  contract_snippet: string;
  alternative_suggestion: string;
  description: string;
  created_at: string;
}

export interface DashboardMetrics {
  totalAudited: number;
  averageRiskScore: number;
  criticalFlagsPending: number;
}

export interface AuditUsage {
  plan_tier: 'free' | 'starter' | 'pro';
  billing_status: 'free' | 'active' | 'trialing' | 'past_due' | 'canceled';
  free_audits_used: number;
  free_audits_remaining: number;
  monthly_audits_used: number;
  monthly_audits_limit: number;
  monthly_audits_remaining: number;
  can_upload: boolean;
  can_use_custom_playbooks: boolean;
  can_invite_team: boolean;
  is_workspace_owner: boolean;
}

export interface ContractVersion {
  id: string;
  contract_id: string;
  organization_id: string;
  user_id: string;
  file_name: string;
  file_url: string;
  file_content: string;
  created_at: string;
}

// Pagination
export interface PaginatedResult<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
}
