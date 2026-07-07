import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, AlertTriangle, XCircle, AlertCircle,
  ChevronDown, Copy, Check, Loader2, FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { RiskBadge, CriticalBadge, StatusBadge } from '@/components/contracts/Badges';
import { getContractById, getAuditResults, runAudit } from '@/services/api';
import type { Contract, AuditResult } from '@/types/types';

const MOCK_CONTRACT_TEXT = `SOFTWARE LICENSE AGREEMENT

This Software License Agreement ("Agreement") is entered into as of January 1, 2024, between TechCorp Solutions Inc. ("Licensor") and Client Organization LLC ("Licensee").

1. GRANT OF LICENSE
Licensor hereby grants Licensee a non-exclusive, non-transferable, limited license to use the software product ("Software") solely for Licensee's internal business purposes.

2. INDEMNIFICATION
Licensee shall indemnify, defend, and hold harmless Licensor from any claims arising out of Licensee's use of the Software. Licensor shall have no obligation to indemnify Licensee under any circumstances whatsoever.

3. LIMITATION OF LIABILITY
IN NO EVENT SHALL LICENSOR BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES. THE TOTAL LIABILITY OF LICENSOR SHALL NOT EXCEED ONE HUNDRED DOLLARS ($100), REGARDLESS OF THE AMOUNT OF FEES PAID.

4. GOVERNING LAW
This Agreement shall be governed by the laws of the State of California, without regard to its conflict of law principles. Any disputes shall be resolved in the courts of San Francisco County, California.

5. TERM AND TERMINATION
This Agreement shall commence on the Effective Date and continue for a period of one (1) year. Either party may terminate this Agreement with ninety (90) days written notice.

6. CONFIDENTIALITY
Each party agrees to maintain the confidentiality of the other party's proprietary information. Confidential information shall mean any information designated as confidential in writing.

7. INTELLECTUAL PROPERTY
All intellectual property created by Licensor prior to or independent of this Agreement shall remain the sole property of Licensor.

8. DATA PROCESSING
The parties acknowledge that Licensor may process personal data on behalf of Licensee. Such processing shall be conducted in accordance with applicable law. No specific data processing agreement is attached hereto.

9. ENTIRE AGREEMENT
This Agreement constitutes the entire agreement between the parties concerning the subject matter hereof.

IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.

LICENSOR: TechCorp Solutions Inc.
By: _____________________________
Name: John Smith
Title: Chief Executive Officer

LICENSEE: Client Organization LLC
By: _____________________________
Name: Jane Doe
Title: General Counsel`;

export default function ContractWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [contract, setContract] = useState<Contract | null>(null);
  const [results, setResults] = useState<AuditResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSnippetId, setActiveSnippetId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);

  const docViewerRef = useRef<HTMLDivElement>(null);
  const highlightRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const [c, r] = await Promise.all([
          getContractById(id!),
          getAuditResults(id!),
        ]);
        setContract(c);
        setResults(r);
      } catch {
        toast.error('Failed to load contract.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  // Scroll document to highlighted snippet
  useEffect(() => {
    if (!activeSnippetId) return;
    const el = highlightRefs.current[activeSnippetId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeSnippetId]);

  async function handleRerun() {
    if (!id) return;
    setIsRerunning(true);
    try {
      await runAudit(id);
      toast.success('Audit restarted. Refresh in a moment to see updated results.');
    } catch (e) {
      toast.error('Failed to trigger audit. Ensure your OpenAI API key is configured.');
    } finally {
      setIsRerunning(false);
    }
  }

  async function copyToClipboard(text: string, resultId: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(resultId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const contractText = contract?.file_content?.startsWith('[Contract:')
    ? MOCK_CONTRACT_TEXT
    : contract?.file_content || MOCK_CONTRACT_TEXT;

  // Categorize results
  const critical = results.filter(r => r.critical_level === 'high' && r.status !== 'passed');
  const missing = results.filter(r => r.status === 'missing');
  const deviations = results.filter(r => r.status === 'flagged' && r.critical_level !== 'high');
  const passed = results.filter(r => r.status === 'passed');

  function renderHighlightedDocument() {
    if (!contractText) return null;

    // Build highlight map: snippet text -> result id
    const highlightMap: Array<{ snippet: string; resultId: string; level: string }> = results
      .filter(r => r.contract_snippet && r.status !== 'passed')
      .map(r => ({ snippet: r.contract_snippet, resultId: r.id, level: r.critical_level }));

    let remaining = contractText;
    const segments: React.ReactNode[] = [];
    let idx = 0;

    while (remaining.length > 0) {
      let earliest: { pos: number; len: number; resultId: string; level: string } | null = null;

      for (const { snippet, resultId, level } of highlightMap) {
        const pos = remaining.indexOf(snippet);
        if (pos >= 0 && (!earliest || pos < earliest.pos)) {
          earliest = { pos, len: snippet.length, resultId, level };
        }
      }

      if (!earliest) {
        segments.push(<span key={`t-${idx++}`}>{remaining}</span>);
        break;
      }

      if (earliest.pos > 0) {
        segments.push(<span key={`t-${idx++}`}>{remaining.slice(0, earliest.pos)}</span>);
      }

      const isActive = activeSnippetId === earliest.resultId;
      segments.push(
        <span
          key={`h-${earliest.resultId}`}
          ref={el => { highlightRefs.current[earliest!.resultId] = el; }}
          onClick={() => setActiveSnippetId(isActive ? null : earliest!.resultId)}
          className={cn(
            'cursor-pointer rounded px-0.5 transition-colors',
            isActive
              ? earliest.level === 'high'
                ? 'bg-red-100 dark:bg-red-950/40 underline decoration-dotted'
                : 'bg-amber-100 dark:bg-amber-950/40 underline decoration-dotted'
              : earliest.level === 'high'
              ? 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40'
              : 'bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/40'
          )}
        >
          {remaining.slice(earliest.pos, earliest.pos + earliest.len)}
        </span>
      );

      remaining = remaining.slice(earliest.pos + earliest.len);
    }

    return segments;
  }

  if (loading) {
    return (
      <div className="px-4 md:px-8 py-8 max-w-7xl mx-auto w-full">
        <Skeleton className="h-6 w-48 mb-8" />
        <div className="flex gap-6">
          <Skeleton className="flex-1 h-[600px] rounded-md" />
          <Skeleton className="w-80 h-[600px] rounded-md shrink-0" />
        </div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <FileText className="h-12 w-12 text-muted-foreground/30" strokeWidth={1} />
        <p className="text-muted-foreground">Contract not found.</p>
        <Button variant="ghost" onClick={() => navigate('/dashboard')}>Back to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-border shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => navigate('/dashboard')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{contract.file_name}</p>
            <p className="text-xs text-muted-foreground">
              {contract.playbook?.name ?? 'No playbook'} · {new Date(contract.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <RiskBadge score={contract.risk_score} />
          <StatusBadge status={contract.status} />
          {contract.status === 'completed' || contract.status === 'failed' ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={handleRerun}
              disabled={isRerunning}
            >
              {isRerunning && <Loader2 className="h-3 w-3 animate-spin" />}
              Re-analyze
            </Button>
          ) : null}
        </div>
      </div>

      {/* Two-column workspace */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Document viewer */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6 md:p-8" ref={docViewerRef}>
          <div className="max-w-2xl mx-auto">
            <div className="text-xs text-muted-foreground mb-4 flex items-center gap-2">
              <FileText className="h-3.5 w-3.5" />
              Document Preview
              {results.length > 0 && (
                <span className="ml-1">· Click highlighted text to view associated findings</span>
              )}
            </div>
            <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 border border-border rounded-md p-6 bg-card">
              {contract.status === 'processing' ? (
                <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p className="text-sm">Audit in progress…</p>
                </div>
              ) : (
                renderHighlightedDocument()
              )}
            </div>
          </div>
        </div>

        <Separator orientation="vertical" className="shrink-0" />

        {/* Right: Audit results sidebar */}
        <div className="w-80 xl:w-96 shrink-0 overflow-y-auto flex flex-col">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Audit Results</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {results.length} findings · {passed.length} passed
            </p>
          </div>

          {contract.status === 'uploaded' || contract.status === 'processing' ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm text-center">Audit in progress. Results will appear here.</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-muted-foreground">
              <Check className="h-8 w-8 text-green-500" strokeWidth={1.5} />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">No issues found</p>
                <p className="text-xs mt-1">This contract passed all playbook checks.</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs mt-2 gap-1.5"
                onClick={handleRerun}
                disabled={isRerunning}
              >
                {isRerunning && <Loader2 className="h-3 w-3 animate-spin" />}
                Run audit
              </Button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <Accordion type="multiple" defaultValue={['critical', 'missing']} className="px-3 py-3">
                {critical.length > 0 && (
                  <AuditSection
                    value="critical"
                    label="Critical Risks"
                    icon={<AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                    count={critical.length}
                    results={critical}
                    activeId={activeSnippetId}
                    copiedId={copiedId}
                    onSelect={setActiveSnippetId}
                    onCopy={copyToClipboard}
                  />
                )}
                {missing.length > 0 && (
                  <AuditSection
                    value="missing"
                    label="Missing Clauses"
                    icon={<XCircle className="h-3.5 w-3.5 text-amber-500" />}
                    count={missing.length}
                    results={missing}
                    activeId={activeSnippetId}
                    copiedId={copiedId}
                    onSelect={setActiveSnippetId}
                    onCopy={copyToClipboard}
                  />
                )}
                {deviations.length > 0 && (
                  <AuditSection
                    value="deviations"
                    label="Deviations"
                    icon={<AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                    count={deviations.length}
                    results={deviations}
                    activeId={activeSnippetId}
                    copiedId={copiedId}
                    onSelect={setActiveSnippetId}
                    onCopy={copyToClipboard}
                  />
                )}
                {passed.length > 0 && (
                  <AuditSection
                    value="passed"
                    label="Passed Checks"
                    icon={<Check className="h-3.5 w-3.5 text-green-500" />}
                    count={passed.length}
                    results={passed}
                    activeId={activeSnippetId}
                    copiedId={copiedId}
                    onSelect={setActiveSnippetId}
                    onCopy={copyToClipboard}
                  />
                )}
              </Accordion>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface AuditSectionProps {
  value: string;
  label: string;
  icon: React.ReactNode;
  count: number;
  results: AuditResult[];
  activeId: string | null;
  copiedId: string | null;
  onSelect: (id: string | null) => void;
  onCopy: (text: string, id: string) => void;
}

function AuditSection({ value, label, icon, count, results, activeId, copiedId, onSelect, onCopy }: AuditSectionProps) {
  return (
    <AccordionItem value={value} className="border-b border-border last:border-0">
      <AccordionTrigger className="py-3 hover:no-underline">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {label}
          <span className="text-xs text-muted-foreground font-normal ml-1">({count})</span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-2 pb-2">
          {results.map(r => (
            <AuditResultCard
              key={r.id}
              result={r}
              isActive={activeId === r.id}
              isCopied={copiedId === r.id}
              onSelect={onSelect}
              onCopy={onCopy}
            />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function AuditResultCard({
  result,
  isActive,
  isCopied,
  onSelect,
  onCopy,
}: {
  result: AuditResult;
  isActive: boolean;
  isCopied: boolean;
  onSelect: (id: string | null) => void;
  onCopy: (text: string, id: string) => void;
}) {
  return (
    <div
      className={cn(
        'rounded-md border p-3 text-xs cursor-pointer transition-colors',
        isActive
          ? 'border-accent/50 bg-accent/5'
          : 'border-border hover:border-muted-foreground/30 hover:bg-muted/20'
      )}
      onClick={() => onSelect(isActive ? null : result.id)}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="font-medium text-xs truncate">{result.category}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <CriticalBadge level={result.critical_level} />
          <StatusBadge status={result.status} />
        </div>
      </div>

      <p className="text-muted-foreground leading-relaxed mb-2">{result.description}</p>

      {result.contract_snippet && result.status !== 'missing' && (
        <div className="snippet-highlight mb-2">
          <p className="text-xs text-muted-foreground italic leading-relaxed">
            &ldquo;{result.contract_snippet}&rdquo;
          </p>
        </div>
      )}

      {result.alternative_suggestion && (
        <div className="mt-2 pt-2 border-t border-border/60">
          <p className="text-muted-foreground font-medium mb-1">Suggested alternative:</p>
          <p className="text-foreground/80 leading-relaxed">{result.alternative_suggestion}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-6 text-xs gap-1.5 px-2 text-muted-foreground hover:text-foreground"
            onClick={e => {
              e.stopPropagation();
              onCopy(result.alternative_suggestion, result.id);
            }}
          >
            {isCopied ? (
              <><Check className="h-3 w-3 text-green-500" /> Copied</>
            ) : (
              <><Copy className="h-3 w-3" /> Copy phrasing</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
