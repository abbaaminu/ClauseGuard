import { useMemo } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { diffContractText } from '@/lib/contract-diff';

export function ContractDiff({
  beforeLabel,
  afterLabel,
  before,
  after,
}: {
  beforeLabel: string;
  afterLabel: string;
  before: string;
  after: string;
}) {
  const blocks = useMemo(() => diffContractText(before, after), [before, after]);
  const added = blocks.filter(block => block.kind === 'added')
    .reduce((count, block) => count + block.lines.length, 0);
  const removed = blocks.filter(block => block.kind === 'removed')
    .reduce((count, block) => count + block.lines.length, 0);

  return (
    <section aria-label="Contract revision comparison" className="mt-6 border border-border rounded-md overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-3 border-b border-border bg-muted/30">
        <p className="text-sm font-medium flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4" /> Redline comparison
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="text-green-700 dark:text-green-400">+{added} added</span>
          {' · '}
          <span className="text-red-700 dark:text-red-400">−{removed} removed</span>
        </p>
      </div>
      <div className="grid grid-cols-2 border-b border-border text-xs font-medium">
        <p className="px-3 py-2 truncate border-r border-border" title={beforeLabel}>Original: {beforeLabel}</p>
        <p className="px-3 py-2 truncate" title={afterLabel}>Revision: {afterLabel}</p>
      </div>
      <div className="max-h-[480px] overflow-auto font-mono text-xs leading-5">
        {blocks.map((block, index) => (
          <pre
            key={`${block.kind}-${index}`}
            className={`whitespace-pre-wrap break-words px-3 py-1 ${
              block.kind === 'added'
                ? 'bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200'
                : block.kind === 'removed'
                  ? 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200 line-through decoration-red-400'
                  : 'text-muted-foreground'
            }`}
          >
            <span aria-hidden="true" className="mr-2 select-none">{block.kind === 'added' ? '+' : block.kind === 'removed' ? '−' : ' '}</span>
            {block.lines.join('\n') || ' '}
          </pre>
        ))}
      </div>
    </section>
  );
}
