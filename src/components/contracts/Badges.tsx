import { cn } from '@/lib/utils';

type RiskLevel = 'low' | 'medium' | 'high' | null;

function getRiskLevel(score: number | null): RiskLevel {
  if (score === null) return null;
  if (score <= 30) return 'low';
  if (score <= 70) return 'medium';
  return 'high';
}

interface RiskBadgeProps {
  score: number | null;
  className?: string;
}

export function RiskBadge({ score, className }: RiskBadgeProps) {
  const level = getRiskLevel(score);
  if (score === null || level === null) {
    return (
      <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs border', className)}>
        —
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border font-medium',
        level === 'low' && 'risk-low',
        level === 'medium' && 'risk-medium',
        level === 'high' && 'risk-high',
        className
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          level === 'low' && 'bg-current',
          level === 'medium' && 'bg-current',
          level === 'high' && 'bg-current'
        )}
      />
      {score}
    </span>
  );
}

interface CriticalBadgeProps {
  level: 'low' | 'medium' | 'high';
  className?: string;
}

export function CriticalBadge({ level, className }: CriticalBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs border font-medium capitalize',
        level === 'low' && 'risk-low',
        level === 'medium' && 'risk-medium',
        level === 'high' && 'risk-high',
        className
      )}
    >
      {level}
    </span>
  );
}

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusStyles: Record<string, string> = {
  uploaded: 'text-muted-foreground bg-muted border-border',
  processing: 'text-yellow-700 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950/30 dark:border-yellow-800',
  completed: 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950/30 dark:border-green-800',
  failed: 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30 dark:border-red-800',
  passed: 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950/30 dark:border-green-800',
  flagged: 'risk-high',
  missing: 'risk-medium',
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs border font-medium capitalize',
        statusStyles[status] ?? 'text-muted-foreground bg-muted border-border',
        className
      )}
    >
      {status}
    </span>
  );
}
