import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, AlertTriangle, XCircle, AlertCircle,
  Copy, Check, Loader2, FileText, Download, GitCompareArrows, Upload
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { RiskBadge, CriticalBadge, StatusBadge } from '@/components/contracts/Badges';
import { ContractDiff } from '@/components/contracts/ContractDiff';
import {
  getContractById,
  getAuditResults,
  getContractVersions,
  addContractVersion,
  getAuditUsage,
  runAudit,
  subscribeToContract,
  type ContractStatusUpdate,
} from '@/services/api';
import type { Contract, AuditResult, ContractVersion } from '@/types/types';

export default function ContractWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [contract, setContract] = useState<Contract | null>(null);
  const [results, setResults] = useState<AuditResult[]>([]);
  const [versions, setVersions] = useState<ContractVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [savingVersion, setSavingVersion] = useState(false);
  const [canUseDocx, setCanUseDocx] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeSnippetId, setActiveSnippetId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);

  const docViewerRef = useRef<HTMLDivElement>(null);
  const versionInputRef = useRef<HTMLInputElement>(null);
  const highlightRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const auditToastIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    const contractId = id;
    let cancelled = false;
    let latestUpdate: ContractStatusUpdate | null = null;
    let currentStatus: Contract['status'] | null = null;

    const refreshResults = async () => {
      try {
        const nextResults = await getAuditResults(contractId);
        if (!cancelled) setResults(nextResults);
      } catch {
        if (!cancelled) toast.error('Failed to refresh audit results.');
      }
    };

    const unsubscribe = subscribeToContract(contractId, (update) => {
      const previousStatus = currentStatus;
      latestUpdate = update;
      currentStatus = update.status;
      setContract((current) =>
        current?.id === update.id ? { ...current, ...update } : current
      );

      if (update.status === 'processing' && previousStatus !== 'processing' && !auditToastIdRef.current) {
        auditToastIdRef.current = toast.loading('Contract audit in progress...');
      }
      if (previousStatus === 'processing' && update.status === 'failed') {
        toast.error('The contract audit failed.', { id: auditToastIdRef.current ?? undefined });
        auditToastIdRef.current = null;
      }
      if (previousStatus === 'processing' && update.status === 'completed') {
        toast.success('Contract audit completed.', { id: auditToastIdRef.current ?? undefined });
        auditToastIdRef.current = null;
      }
      if (update.status === 'completed') void refreshResults();
    });

    async function load() {
      try {
        const [c, r, savedVersions] = await Promise.all([
          getContractById(contractId),
          getAuditResults(contractId),
          getContractVersions(contractId),
        ]);
        if (cancelled) return;
        const refreshedContract = c && latestUpdate?.id === c.id
          ? { ...c, ...latestUpdate }
          : c;
        currentStatus = refreshedContract?.status ?? null;
        setContract(refreshedContract);
        setResults(r);
        setVersions(savedVersions);
        setSelectedVersionId(savedVersions[0]?.id ?? '');
        if (latestUpdate?.status === 'completed') void refreshResults();
      } catch {
        if (!cancelled) toast.error('Failed to load contract.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    getAuditUsage()
      .then(usage => {
        if (!cancelled) setCanUseDocx(usage.can_use_custom_playbooks);
      })
      .catch(() => {
        if (!cancelled) toast.error('Could not load plan permissions for revision extraction.');
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id]);

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

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
    const toastId = toast.loading('Starting contract audit...');
    auditToastIdRef.current = toastId;
    try {
      const { warning } = await runAudit(id);
      const [updatedContract, updatedResults] = await Promise.all([
        getContractById(id),
        getAuditResults(id),
      ]);
      if (updatedContract) setContract(updatedContract);
      setResults(updatedResults);
      if (auditToastIdRef.current === toastId) {
        if (warning) {
          toast.warning('Audit completed with fallback results.', { description: warning, id: toastId });
        } else {
          toast.success('Contract audit completed.', { id: toastId });
        }
        auditToastIdRef.current = null;
      }
    } catch (err) {
      if (auditToastIdRef.current === toastId) {
        const quotaReached = err instanceof Error && /limit|credits exhausted/i.test(err.message);
        toast.error(
          err instanceof Error
            ? `Audit could not be restarted: ${err.message}`
            : 'Audit could not be restarted. Check the document text, playbook, and AI configuration.',
          { id: toastId }
        );
        auditToastIdRef.current = null;
        if (quotaReached) navigate('/billing');
      }
    } finally {
      setIsRerunning(false);
    }
  }

  async function handleAddRevision(file: File | undefined) {
    if (!file || !contract) return;
    setSavingVersion(true);
    try {
      const version = await addContractVersion(contract, file);
      setVersions(current => [version, ...current]);
      setSelectedVersionId(version.id);
      toast.success('Contract revision saved for comparison.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save this contract revision.');
    } finally {
      setSavingVersion(false);
      if (versionInputRef.current) versionInputRef.current.value = '';
    }
  }

  async function copyToClipboard(text: string, resultId: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(resultId);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Could not copy text to the clipboard.');
    }
  }

  const storedContractText = contract?.file_content?.trim() ?? '';
  const hasExtractedText = storedContractText.length > 0 && !storedContractText.startsWith('[Contract:');
  const contractText = hasExtractedText ? storedContractText : '';

  // Categorize results
  const critical = results.filter(r => r.critical_level === 'high' && r.status !== 'passed');
  const missing = results.filter(r => r.status === 'missing');
  const deviations = results.filter(r => r.status === 'flagged' && r.critical_level !== 'high');
  const passed = results.filter(r => r.status === 'passed');
  const selectedVersion = versions.find(version => version.id === selectedVersionId);

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
          {contract.status === 'completed' && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => window.print()}
            >
              <Download className="h-3.5 w-3.5" />
              Export PDF
            </Button>
          )}
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
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                Document Preview
                {results.length > 0 && (
                  <span className="ml-1">· Click highlighted text to view associated findings</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {versions.length > 0 && (
                  <select
                    aria-label="Choose a contract revision to compare"
                    className="h-8 max-w-48 rounded-md border border-input bg-background px-2 text-xs"
                    value={selectedVersionId}
                    onChange={event => setSelectedVersionId(event.target.value)}
                  >
                    {versions.map(version => (
                      <option key={version.id} value={version.id}>
                        {version.file_name} · {new Date(version.created_at).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  ref={versionInputRef}
                  type="file"
                  accept={canUseDocx ? '.txt,.pdf,.docx' : '.txt,.pdf'}
                  className="hidden"
                  aria-label="Upload a newer contract revision"
                  onChange={event => void handleAddRevision(event.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  disabled={savingVersion}
                  onClick={() => versionInputRef.current?.click()}
                >
                  {savingVersion ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {savingVersion ? 'Saving…' : 'Add revision'}
                </Button>
              </div>
            </div>
            <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 border border-border rounded-md p-6 bg-card">
              {contract.status === 'processing' ? (
                <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p className="text-sm">Audit in progress…</p>
                </div>
              ) : hasExtractedText ? (
                renderHighlightedDocument()
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Text extraction is unavailable for this document.
                </p>
              )}
            </div>
            {hasExtractedText && selectedVersion && (
              <ContractDiff
                beforeLabel={contract.file_name}
                afterLabel={selectedVersion.file_name}
                before={contractText}
                after={selectedVersion.file_content}
              />
            )}
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
      {contract.status === 'completed' && (
        <>
          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              #audit-report, #audit-report * { visibility: visible !important; }
              #audit-report {
                display: block !important;
                position: absolute;
                inset: 0;
                width: 100%;
                padding: 36px;
                color: #17212b;
                background: white;
                font-family: Arial, sans-serif;
              }
              html, body, #root, #root * {
                height: auto !important;
                max-height: none !important;
                overflow: visible !important;
              }
              @page { margin: 14mm; }
            }
          `}</style>
          <article id="audit-report" className="hidden">
            <header style={{ borderBottom: '2px solid #17212b', paddingBottom: 16, marginBottom: 24 }}>
              <p style={{ color: '#426b65', fontWeight: 700, letterSpacing: 2, fontSize: 12 }}>CLAUSEGUARD · COMPLIANCE SUMMARY</p>
              <h1 style={{ fontSize: 26, margin: '12px 0 6px' }}>{contract.file_name}</h1>
              <p style={{ color: '#58636d', fontSize: 12 }}>
                Generated {new Date().toLocaleDateString()} · Playbook: {contract.playbook?.name ?? 'No playbook'}
              </p>
            </header>
            <section style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
              <div style={{ border: '1px solid #cbd5d1', borderRadius: 8, padding: 16, minWidth: 150 }}>
                <p style={{ color: '#58636d', fontSize: 11 }}>OVERALL RISK SCORE</p>
                <p style={{ fontSize: 32, fontWeight: 700, margin: '5px 0' }}>{contract.risk_score ?? 0}/100</p>
              </div>
              <div style={{ border: '1px solid #cbd5d1', borderRadius: 8, padding: 16 }}>
                <p style={{ color: '#58636d', fontSize: 11 }}>AUDIT SUMMARY</p>
                <p style={{ fontSize: 14, margin: '6px 0' }}>{results.length} rules reviewed · {passed.length} passed</p>
                <p style={{ fontSize: 14, margin: '6px 0', color: '#9a3412' }}>
                  {results.filter(result => result.status !== 'passed').length} items require attention
                </p>
              </div>
            </section>
            <h2 style={{ fontSize: 18, marginBottom: 12 }}>Flagged compliance findings</h2>
            {results.filter(result => result.status !== 'passed').length === 0 ? (
              <p>No compliance flags were identified by the selected playbook.</p>
            ) : results.filter(result => result.status !== 'passed').map(result => (
              <section key={result.id} style={{ borderLeft: '4px solid #c2410c', background: '#fff7ed', padding: '12px 16px', marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, margin: '0 0 5px' }}>
                  {result.category} · {result.critical_level.toUpperCase()} · {result.status.toUpperCase()}
                </h3>
                <p style={{ fontSize: 12, margin: '4px 0' }}>{result.description}</p>
                {result.contract_snippet && <p style={{ fontSize: 12, fontStyle: 'italic', margin: '7px 0' }}>“{result.contract_snippet}”</p>}
                {result.alternative_suggestion && <p style={{ fontSize: 12, margin: '7px 0' }}><strong>Suggested alternative:</strong> {result.alternative_suggestion}</p>}
              </section>
            ))}
            <footer style={{ borderTop: '1px solid #cbd5d1', paddingTop: 12, marginTop: 24, color: '#58636d', fontSize: 10 }}>
              Prepared with ClauseGuard. This automated compliance summary is not legal advice.
            </footer>
          </article>
        </>
      )}
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
