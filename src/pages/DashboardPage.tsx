import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FileText, RefreshCw, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layouts/AppLayout';
import { UploadZone } from '@/components/contracts/UploadZone';
import { RiskBadge, StatusBadge } from '@/components/contracts/Badges';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import {
  getContracts, getPlaybooks, getDashboardMetrics,
  uploadContract, runAudit, deleteContract
} from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import type { Contract, Playbook, DashboardMetrics } from '@/types/types';

const PAGE_SIZE = 10;

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchData = useCallback(async () => {
    try {
      const [pb, contractsRes, met] = await Promise.all([
        getPlaybooks(),
        getContracts(page, PAGE_SIZE),
        getDashboardMetrics(),
      ]);
      setPlaybooks(pb);
      setContracts(contractsRes.data);
      setTotalCount(contractsRes.count);
      setMetrics(met);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Poll if any contract is in 'processing' state
  useEffect(() => {
    const hasProcessing = contracts.some(c => c.status === 'processing');
    if (hasProcessing) {
      pollingRef.current = setTimeout(fetchData, 5000);
    }
    return () => { if (pollingRef.current) clearTimeout(pollingRef.current); };
  }, [contracts, fetchData]);

  async function handleUpload(file: File, playbookId: string | null) {
    if (!user) return;
    setUploading(true);
    try {
      const contract = await uploadContract(file, playbookId, user.id);
      toast.success(`"${file.name}" uploaded. Starting audit…`);
      // Trigger audit
      try {
        await runAudit(contract.id);
      } catch (auditErr) {
        console.warn('Audit trigger error (will retry via polling):', auditErr);
      }
      await fetchData();
    } catch (err) {
      toast.error('Upload failed. Please try again.');
      console.error(err);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteContract(id);
      toast.success('Contract deleted.');
      await fetchData();
    } catch {
      toast.error('Failed to delete contract.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="px-4 md:px-8 py-8 max-w-6xl mx-auto w-full">
      <PageHeader
        title="Dashboard"
        subtitle="Upload contracts and track compliance audits."
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchData}
            className="text-muted-foreground gap-2 h-8"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="sr-only md:not-sr-only text-xs">Refresh</span>
          </Button>
        }
      />

      {/* Metrics row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="h-24">
              <CardContent className="p-5">
                <Skeleton className="h-4 w-32 mb-3" />
                <Skeleton className="h-7 w-16" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <MetricCard label="Total Audited Contracts" value={metrics?.totalAudited ?? 0} />
            <MetricCard
              label="Average Risk Score"
              value={metrics?.averageRiskScore ?? 0}
              renderValue={v => (
                <RiskBadge score={v as number} className="text-base px-3 py-1" />
              )}
            />
            <MetricCard label="Critical Flags Pending" value={metrics?.criticalFlagsPending ?? 0} accent />
          </>
        )}
      </div>

      {/* Upload zone */}
      <Card className="mb-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">New Contract</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5">
          <UploadZone playbooks={playbooks} onUpload={handleUpload} uploading={uploading} />
        </CardContent>
      </Card>

      {/* Contracts table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-medium">All Contracts</CardTitle>
          <span className="text-xs text-muted-foreground">{totalCount} total</span>
        </CardHeader>
        <Separator />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-max">
            <thead>
              <tr className="border-b border-border">
                {['File Name', 'Date', 'Playbook', 'Risk Score', 'Status', ''].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground px-5 py-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-5 py-3">
                        <Skeleton className="h-4 w-full max-w-24" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : contracts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">No contracts yet. Upload one above.</p>
                  </td>
                </tr>
              ) : (
                contracts.map(c => (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer group"
                    onClick={() => navigate(`/contracts/${c.id}`)}
                  >
                    <td className="px-5 py-3 font-medium max-w-xs">
                      <span className="truncate block max-w-[200px]">{c.file_name}</span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                      {c.playbook?.name ?? <span className="italic">None</span>}
                    </td>
                    <td className="px-5 py-3">
                      <RiskBadge score={c.risk_score} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-5 py-3" onClick={e => e.stopPropagation()}>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                            disabled={deletingId === c.id}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete contract?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete <strong>{c.file_name}</strong> and all its audit results.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(c.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <>
            <Separator />
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
  renderValue,
}: {
  label: string;
  value: number;
  accent?: boolean;
  renderValue?: (v: number) => React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs text-muted-foreground mb-2">{label}</p>
        {renderValue ? (
          renderValue(value)
        ) : (
          <p
            className="text-2xl font-semibold tracking-tight"
            style={accent && value > 0 ? { color: 'hsl(var(--risk-high))' } : undefined}
          >
            {value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
