import { useEffect, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, BookOpen, ShieldCheck,
  ChevronDown, ChevronUp, Loader2, Check, X
} from 'lucide-react';
import { PageHeader } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { getPlaybooks, createPlaybook, updatePlaybook, deletePlaybook } from '@/services/api';
import type { Playbook, PlaybookRule, CriticalLevel } from '@/types/types';

const ruleSchema = z.object({
  id: z.string(),
  title: z.string().min(3, 'Rule title is required'),
  description: z.string().min(10, 'Provide a detailed description'),
  severity: z.enum(['low', 'medium', 'high']),
});

const playbookSchema = z.object({
  name: z.string().min(3, 'Playbook name must be at least 3 characters'),
  rules_json: z.array(ruleSchema).min(1, 'Add at least one rule'),
});
type PlaybookFormValues = z.infer<typeof playbookSchema>;

const SEVERITY_COLORS: Record<CriticalLevel, string> = {
  low: 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950/30 dark:border-green-800',
  medium: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-800',
  high: 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30 dark:border-red-800',
};

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState<Playbook | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const form = useForm<PlaybookFormValues>({
    resolver: zodResolver(playbookSchema),
    defaultValues: { name: '', rules_json: [] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'rules_json' });

  async function fetchPlaybooks() {
    try {
      const data = await getPlaybooks();
      setPlaybooks(data);
    } catch {
      toast.error('Failed to load playbooks.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchPlaybooks(); }, []);

  function openCreateDialog() {
    setEditingPlaybook(null);
    form.reset({
      name: '',
      rules_json: [{ id: crypto.randomUUID(), title: '', description: '', severity: 'medium' }],
    });
    setDialogOpen(true);
  }

  function openEditDialog(pb: Playbook) {
    setEditingPlaybook(pb);
    form.reset({ name: pb.name, rules_json: pb.rules_json });
    setDialogOpen(true);
  }

  async function onSubmit(values: PlaybookFormValues) {
    setSaving(true);
    try {
      if (editingPlaybook) {
        await updatePlaybook(editingPlaybook.id, values.name, values.rules_json as PlaybookRule[]);
        toast.success('Playbook updated.');
      } else {
        await createPlaybook(values.name, values.rules_json as PlaybookRule[]);
        toast.success('Playbook created.');
      }
      setDialogOpen(false);
      await fetchPlaybooks();
    } catch (err) {
      toast.error('Failed to save playbook.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deletePlaybook(id);
      toast.success('Playbook deleted.');
      await fetchPlaybooks();
    } catch {
      toast.error('Failed to delete playbook.');
    } finally {
      setDeletingId(null);
    }
  }

  const systemPlaybooks = playbooks.filter(p => p.is_system);
  const customPlaybooks = playbooks.filter(p => !p.is_system);

  return (
    <div className="px-4 md:px-8 py-8 max-w-4xl mx-auto w-full">
      <PageHeader
        title="Playbooks"
        subtitle="Manage compliance templates and custom audit rules."
        action={
          <Button onClick={openCreateDialog} size="sm" className="h-8 text-xs gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Playbook
          </Button>
        }
      />

      {/* System playbooks */}
      <section className="mb-8">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Standard Compliance Profiles
        </h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-md" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {systemPlaybooks.map(pb => (
              <PlaybookCard
                key={pb.id}
                playbook={pb}
                expanded={expandedId === pb.id}
                onToggle={() => setExpandedId(expandedId === pb.id ? null : pb.id)}
                onEdit={() => {}}
                onDelete={() => {}}
                deletingId={deletingId}
                readonly
              />
            ))}
          </div>
        )}
      </section>

      {/* Custom playbooks */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Custom Playbooks
          </h2>
          {customPlaybooks.length > 0 && (
            <span className="text-xs text-muted-foreground">{customPlaybooks.length} total</span>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 rounded-md" />
          </div>
        ) : customPlaybooks.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-10">
              <BookOpen className="h-8 w-8 text-muted-foreground/40" strokeWidth={1} />
              <p className="text-sm text-muted-foreground">No custom playbooks yet.</p>
              <Button variant="ghost" size="sm" className="text-xs gap-1.5" onClick={openCreateDialog}>
                <Plus className="h-3.5 w-3.5" />
                Create your first playbook
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {customPlaybooks.map(pb => (
              <PlaybookCard
                key={pb.id}
                playbook={pb}
                expanded={expandedId === pb.id}
                onToggle={() => setExpandedId(expandedId === pb.id ? null : pb.id)}
                onEdit={() => openEditDialog(pb)}
                onDelete={() => handleDelete(pb.id)}
                deletingId={deletingId}
              />
            ))}
          </div>
        )}
      </section>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {editingPlaybook ? 'Edit Playbook' : 'New Playbook'}
            </DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 mt-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm">Playbook Name</FormLabel>
                    <FormControl>
                      <Input className="h-9 px-3" placeholder="e.g., Delaware Governing Law Standard" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Rules</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() =>
                      append({ id: crypto.randomUUID(), title: '', description: '', severity: 'medium' })
                    }
                  >
                    <Plus className="h-3 w-3" /> Add rule
                  </Button>
                </div>

                {fields.length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-2">No rules added yet.</p>
                )}

                <div className="space-y-3">
                  {fields.map((field, index) => (
                    <div key={field.id} className="border border-border rounded-md p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground font-medium">Rule {index + 1}</p>
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <FormField
                        control={form.control}
                        name={`rules_json.${index}.title`}
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Title</FormLabel>
                            <FormControl>
                              <Input className="h-8 px-2.5 text-xs" placeholder="e.g., Governing Law must be Delaware" {...f} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`rules_json.${index}.description`}
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Description / Rule</FormLabel>
                            <FormControl>
                              <Textarea
                                className="text-xs px-2.5 min-h-16 resize-none"
                                placeholder="Governing law must strictly be the state of Delaware. Flag any other jurisdiction."
                                {...f}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`rules_json.${index}.severity`}
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Severity</FormLabel>
                            <Select onValueChange={f.onChange} defaultValue={f.value}>
                              <FormControl>
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="low">Low</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  ))}
                </div>
                {form.formState.errors.rules_json?.root && (
                  <p className="text-xs text-destructive mt-1">
                    {form.formState.errors.rules_json.root.message}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saving ? 'Saving…' : editingPlaybook ? 'Save changes' : 'Create playbook'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlaybookCard({
  playbook, expanded, onToggle, onEdit, onDelete, deletingId, readonly = false
}: {
  playbook: Playbook;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deletingId: string | null;
  readonly?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3.5 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 min-w-0">
          {playbook.is_system ? (
            <ShieldCheck className="h-4 w-4 text-accent shrink-0" strokeWidth={1.5} />
          ) : (
            <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{playbook.name}</p>
            <p className="text-xs text-muted-foreground">{playbook.rules_json.length} rules</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {playbook.is_system && (
            <span className="text-xs text-muted-foreground border border-border px-2 py-0.5 rounded">
              System
            </span>
          )}
          {!readonly && (
            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={onEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={deletingId === playbook.id}
                  >
                    {deletingId === playbook.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />
                    }
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete playbook?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete <strong>{playbook.name}</strong>.
                      Existing contracts using this playbook will not be affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {expanded && (
        <>
          <Separator />
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {playbook.rules_json.map((rule, idx) => (
                <div key={rule.id || idx} className="px-4 py-3 flex items-start gap-3">
                  <span
                    className={`mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs border shrink-0 capitalize ${SEVERITY_COLORS[rule.severity]}`}
                  >
                    {rule.severity}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium mb-0.5">{rule.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{rule.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </>
      )}
    </Card>
  );
}
