// ClauseGuard – shared TypeScript types

export type ContractStatus = 'uploaded' | 'processing' | 'completed' | 'failed';
export type AuditStatus = 'passed' | 'flagged' | 'missing';
export type CriticalLevel = 'low' | 'medium' | 'high';

export interface Profile {
  id: string;
  email: string;
  organization_name: string;
  created_at: string;
}

export interface PlaybookRule {
  id: string;
  title: string;
  description: string;
  severity: CriticalLevel;
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
  file_name: string;
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

// Pagination
export interface PaginatedResult<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
}
