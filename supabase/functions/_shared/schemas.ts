// Strict structured-output contracts for every LLM call in the audit
// pipeline. No downstream code should ever touch a raw, unvalidated LLM
// response — parse it through these schemas first, or reject it.
import { z } from "npm:zod@3.25.76";

export const PlaybookRuleSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(2000),
  severity: z.enum(["low", "medium", "high"]),
});
export type PlaybookRule = z.infer<typeof PlaybookRuleSchema>;
export const PlaybookRuleArraySchema = z.array(PlaybookRuleSchema).min(1).max(20);

export const AuditResultItemSchema = z.object({
  category: z.string().min(1).max(200),
  status: z.enum(["passed", "flagged", "missing"]),
  critical_level: z.enum(["low", "medium", "high"]),
  contract_snippet: z.string().max(5000).default(""),
  description: z.string().max(5000).default(""),
  alternative_suggestion: z.string().max(5000).default(""),
});
export type AuditResultItem = z.infer<typeof AuditResultItemSchema>;

export const AuditResultArraySchema = z.array(AuditResultItemSchema);

/**
 * Parse a raw LLM text response into validated audit items.
 * Returns { ok: true, data } or { ok: false, error } — callers decide
 * whether to retry, escalate to a stronger model, or fall back.
 */
export function parseAuditResponse(
  raw: string
): { ok: true; data: AuditResultItem[] } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "response was not valid JSON" };
  }

  let candidate: unknown;
  if (Array.isArray(json)) {
    candidate = json;
  } else if (typeof json === "object" && json !== null) {
    const record = json as Record<string, unknown>;
    candidate = record.results ?? record.audit_results ?? Object.values(record)[0];
  } else {
    candidate = json;
  }

  const result = AuditResultArraySchema.safeParse(candidate);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues
        .map((i: { path: Array<string | number>; message: string }) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// Model cascade: cheap/fast model for the first pass on every rule, stronger
// model only for the subset of results that came back "flagged" with
// high severity — that's the minority of rules on a typical contract, so
// this keeps cost close to the fast-model baseline while giving the
// highest-stakes findings a second, higher-quality opinion.
// ---------------------------------------------------------------------------
export const FAST_MODEL = 'gemini-3.8-flash';
export const ESCALATION_MODEL = 'gemini-3.8-pro';

export function needsEscalation(item: AuditResultItem): boolean {
  return item.status !== "passed" && item.critical_level === "high";
}
