import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import type { Playbook } from '@/types/types';

interface UploadZoneProps {
  playbooks: Playbook[];
  onUpload: (file: File, playbookId: string | null) => Promise<void>;
  uploading: boolean;
  canUpload: boolean;
  canUseCustomPlaybooks: boolean;
  onUpgrade: () => void;
}

export function UploadZone({
  playbooks,
  onUpload,
  uploading,
  canUpload,
  canUseCustomPlaybooks,
  onUpgrade,
}: UploadZoneProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [playbookId, setPlaybookId] = useState<string>('none');

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) setSelectedFile(accepted[0]);
  }, []);

  const accept = {
    'text/plain': ['.txt'],
    'application/pdf': ['.pdf'],
    ...(canUseCustomPlaybooks
      ? { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] }
      : {}),
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles: 1,
    disabled: uploading || !canUpload,
  });

  async function handleUpload() {
    if (!selectedFile) return;
    await onUpload(selectedFile, playbookId === 'none' ? null : playbookId);
    setSelectedFile(null);
    setPlaybookId('none');
  }

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={cn(
          'border border-dashed rounded-md px-6 py-10 text-center cursor-pointer transition-colors',
          isDragActive
            ? 'border-accent bg-accent/5'
            : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30',
          (uploading || !canUpload) && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input {...getInputProps()} />
        {!canUpload ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <FileText className="h-8 w-8" strokeWidth={1} />
            <p className="text-sm">Your free or monthly audit limit has been reached.</p>
          </div>
        ) : uploading ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" strokeWidth={1} />
            <p className="text-sm">Processing contract…</p>
          </div>
        ) : selectedFile ? (
          <div className="flex flex-col items-center gap-3">
            <FileText className="h-8 w-8 text-accent" strokeWidth={1} />
            <div>
              <p className="text-sm font-medium">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(selectedFile.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setSelectedFile(null); }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" /> Remove
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Upload className="h-8 w-8" strokeWidth={1} />
            <div>
              <p className="text-sm">
                {isDragActive ? 'Drop your contract here' : 'Drag & drop a contract, or click to browse'}
              </p>
              <p className="text-xs mt-1">
                Supported formats: .txt and .pdf{canUseCustomPlaybooks ? ', and .docx' : ' · DOCX extraction is on Pro'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Playbook selector + upload button */}
      {!canUpload ? (
        <Button type="button" className="w-full" onClick={onUpgrade}>Upgrade to keep auditing</Button>
      ) : (
      <div className="flex flex-col md:flex-row gap-3">
        <Select value={playbookId} onValueChange={setPlaybookId} disabled={uploading}>
          <SelectTrigger className="flex-1 h-9 text-sm">
            <SelectValue placeholder="Select a playbook (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No playbook</SelectItem>
            {playbooks.filter(p => p.is_system || canUseCustomPlaybooks).map(p => (
              <SelectItem key={p.id} value={p.id}>
                {p.is_system && '⊹ '}{p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={handleUpload}
          disabled={!selectedFile || uploading}
          className="h-9 px-5 text-sm shrink-0"
        >
          {uploading ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading…</>
          ) : (
            'Upload & Analyze'
          )}
        </Button>
      </div>
      )}
    </div>
  );
}
