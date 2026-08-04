import { createClient } from 'jsr:@supabase/supabase-js@2';
import { loadEnv } from '../_shared/env.ts';
import { redactPii, unredactAuditItem } from '../_shared/redact.ts';
import {
  AuditResultItem,
  ESCALATION_MODEL,
  FAST_MODEL,
  PlaybookRule,
  needsEscalation,
  parseAuditResponse,
} from '../_shared/schemas.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let env;
  try {
    env = loadEnv();
  } catch (envErr) {
    // Fail fast and loud in logs, but never leak which secret values are wrong.
    console.error('Environment validation failed:', envErr);
    return new Response(
      JSON.stringify({ error: 'Server misconfiguration' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    const { contract_id } = await req.json();
    if (!contract_id) {
      return new Response(
        JSON.stringify({ error: 'contract_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch contract. RLS on the underlying tables still applies to
    // interactive user sessions; this service-role client is scoped by the
    // explicit .eq('id', contract_id) plus the multi-tenant trigger on
    // audit_results (see migration 00002) so results can never be written
    // against a different tenant's contract.
    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .select('*, playbook:playbook_id(id, name, rules_json)')
      .eq('id', contract_id)
      .maybeSingle();

    if (contractError || !contract) {
      return new Response(
        JSON.stringify({ error: 'Contract not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await supabase.from('contracts').update({ status: 'processing' }).eq('id', contract_id);

    const rawContractText = contract.file_content || '';
    const playbook = contract.playbook as { id: string; name: string; rules_json: PlaybookRule[] } | null;
    const rules: PlaybookRule[] = playbook?.rules_json ?? [];

    // --- PII redaction pass (before ANYTHING leaves our infra) -----------
    const { redactedText: contractText, mapping } = env.REDACT_PII_BEFORE_LLM
      ? redactPii(rawContractText)
      : { redactedText: rawContractText, mapping: new Map<string, string>() };

    let auditResults: AuditResultItem[] = [];
    let usedModel: string | null = null;

    if (env.GOOGLE_API_KEY && contractText && rules.length > 0) {
      const fastResult = await callGemini(env.GOOGLE_API_KEY, FAST_MODEL, contractText, rules);
      if (fastResult.ok) {
        auditResults = fastResult.data;
        usedModel = FAST_MODEL;

        // --- Model cascade: re-verify only the high-severity flags ------
        const escalationKey = env.GOOGLE_API_KEY_ESCALATION ?? env.GOOGLE_API_KEY;
        const toEscalate = auditResults.filter(needsEscalation);
        if (escalationKey && toEscalate.length > 0) {
          const escalatedRules = rules.filter((r) => toEscalate.some((t) => t.category === r.title));
          const proResult = await callGemini(escalationKey, ESCALATION_MODEL, contractText, escalatedRules);
          if (proResult.ok) {
            const byCategory = new Map(proResult.data.map((r) => [r.category, r]));
            auditResults = auditResults.map((r) => byCategory.get(r.category) ?? r);
            usedModel = `${FAST_MODEL}+${ESCALATION_MODEL}`;
          } else {
            console.warn('Escalation pass failed validation, keeping fast-model results:', proResult.error);
          }
        }
      } else {
        console.error('Fast-model response failed schema validation:', fastResult.error);
      }
    }

    // Fallback: deterministic mock audit when no AI key or empty/invalid result
    if (auditResults.length === 0) {
      auditResults = generateMockAuditResults(contractText, rules);
      usedModel = usedModel ?? 'mock';
    }

    // Reverse redaction so stored/displayed text shows the real contract
    // wording again — redaction only ever protected the outbound LLM call.
    const unredacted = auditResults.map((r) => unredactAuditItem(r, mapping));

    const validated = unredacted.map((r) => ({
      contract_id,
      category: String(r.category || 'General'),
      status: r.status,
      critical_level: r.critical_level,
      contract_snippet: r.contract_snippet,
      alternative_suggestion: r.alternative_suggestion,
      description: r.description,
    }));

    await supabase.from('audit_results').delete().eq('contract_id', contract_id);
    if (validated.length > 0) {
      await supabase.from('audit_results').insert(validated);
    }

    const riskScore = calculateRiskScore(validated);

    await supabase
      .from('contracts')
      .update({ status: 'completed', risk_score: riskScore })
      .eq('id', contract_id);

    return new Response(
      JSON.stringify({ success: true, results_count: validated.length, risk_score: riskScore, model: usedModel }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('run-audit error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function callGemini(
  apiKey: string,
  model: string,
  contractText: string,
  rules: PlaybookRule[]
): Promise<{ ok: true; data: AuditResultItem[] } | { ok: false; error: string }> {
  const prompt = buildPrompt(contractText, rules);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ],
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 300)}` };
    }

    const data = await res.json();
    const rawContent: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return parseAuditResponse(rawContent);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function buildPrompt(contractText: string, rules: PlaybookRule[]): string {
  return `You are an expert legal contract compliance auditor. Analyze the contract below against the provided playbook rules and return a strict JSON array.

STRICT REQUIREMENTS:
1. Return ONLY a valid JSON array — no markdown fences, no explanation, no wrapper object.
2. Produce exactly one result object per rule, in the same order as the rules.
3. "contract_snippet" MUST be an exact verbatim copy of a sentence or clause from the contract. If the clause is missing entirely, set contract_snippet to "". Text may contain tokens like [REDACTED_EMAIL_1] — copy those tokens verbatim, do not invent a replacement value.
4. Never hallucinate contract text — use exact copy-paste or empty string.
5. "status" values:
   - "passed"  — clause present and compliant
   - "flagged" — clause present but non-compliant or risky
   - "missing" — no relevant clause exists
6. "alternative_suggestion" — a professionally drafted safer alternative clause (2-3 sentences max).

JSON schema per item:
{
  "category": string,
  "status": "passed" | "flagged" | "missing",
  "critical_level": "low" | "medium" | "high",
  "contract_snippet": string,
  "description": string,
  "alternative_suggestion": string
}

CONTRACT TEXT:
---
${contractText.slice(0, 12000)}
---

PLAYBOOK RULES:
${rules.map((r, i) => `${i + 1}. [${r.severity.toUpperCase()}] ${r.title}: ${r.description}`).join('\n')}

Return the JSON array now.`;
}

function calculateRiskScore(results: Array<{ status: string; critical_level: string }>): number {
  const weights = { high: 25, medium: 12, low: 5 };
  let score = 0;
  for (const r of results) {
    if (r.status !== 'passed') {
      score += weights[r.critical_level as keyof typeof weights] ?? 5;
    }
  }
  return Math.min(100, score);
}

function generateMockAuditResults(contractText: string, rules: PlaybookRule[]): AuditResultItem[] {
  const text = contractText.toLowerCase();

  const mockPatterns: Record<string, (text: string, fullText: string) => Partial<AuditResultItem>> = {
    indemnification: (t, full) => {
      const hasAsymmetric = t.includes('no obligation to indemnify') || t.includes('shall have no obligation to indemnify');
      const snippet = extractSnippet(full, 'indemnif');
      return hasAsymmetric
        ? {
            status: 'flagged',
            critical_level: 'high',
            contract_snippet: snippet,
            description: 'The indemnification clause is one-sided and only protects the Licensor. Mutual indemnification is standard practice.',
            alternative_suggestion: "Each party shall indemnify, defend, and hold harmless the other party from claims arising out of the indemnifying party's gross negligence or willful misconduct.",
          }
        : {
            status: 'passed',
            critical_level: 'low',
            contract_snippet: snippet,
            description: 'Indemnification clause is present and appears balanced.',
            alternative_suggestion: '',
          };
    },
    'governing law': (t, full) => {
      const snippet = extractSnippet(full, 'governing law') || extractSnippet(full, 'laws of the state');
      const hasDelaware = t.includes('delaware');
      const hasOtherJurisdiction = !hasDelaware && (t.includes('california') || t.includes('new york') || t.includes('texas'));
      return hasOtherJurisdiction
        ? {
            status: 'flagged',
            critical_level: 'high',
            contract_snippet: snippet,
            description: 'Governing law is specified as a jurisdiction other than Delaware, which conflicts with the playbook requirement.',
            alternative_suggestion: 'This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict of law provisions.',
          }
        : !snippet
        ? {
            status: 'missing',
            critical_level: 'high',
            contract_snippet: '',
            description: 'No governing law clause was found in the contract.',
            alternative_suggestion: 'This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware.',
          }
        : {
            status: 'passed',
            critical_level: 'low',
            contract_snippet: snippet,
            description: 'Governing law clause is present and complies with Delaware requirement.',
            alternative_suggestion: '',
          };
    },
    'limitation of liability': (t, full) => {
      const snippet = extractSnippet(full, 'limitation of liability') || extractSnippet(full, 'shall not exceed');
      const lowCap = t.includes('one hundred dollars') || t.includes('$100');
      return lowCap
        ? {
            status: 'flagged',
            critical_level: 'high',
            contract_snippet: snippet,
            description: "Liability cap is set at $100, which is unreasonably low and does not align with industry standards of 12 months' fees.",
            alternative_suggestion: 'The total aggregate liability of either party shall not exceed the amounts paid by Licensee to Licensor in the twelve (12) months immediately preceding the claim.',
          }
        : {
            status: 'passed',
            critical_level: 'low',
            contract_snippet: snippet,
            description: 'Limitation of liability clause is present.',
            alternative_suggestion: '',
          };
    },
    'data processing': (t, full) => {
      const snippet = extractSnippet(full, 'data processing');
      const hasProperDPA = t.includes('data processing agreement') && !t.includes('no specific data processing agreement');
      return !snippet || !hasProperDPA
        ? {
            status: 'missing',
            critical_level: 'high',
            contract_snippet: '',
            description: 'No formal Data Processing Agreement (DPA) is attached or referenced per GDPR Article 28 requirements.',
            alternative_suggestion: 'The parties shall execute a Data Processing Agreement per GDPR Article 28, attached hereto as Exhibit A, governing all personal data processing activities.',
          }
        : {
            status: 'passed',
            critical_level: 'low',
            contract_snippet: snippet,
            description: 'Data processing provisions are present.',
            alternative_suggestion: '',
          };
    },
    'non-compete': (_t, full) => {
      const snippet = extractSnippet(full, 'non-compete') || extractSnippet(full, 'compete');
      return !snippet
        ? {
            status: 'missing',
            critical_level: 'medium',
            contract_snippet: '',
            description: 'No non-compete clause found in this contract.',
            alternative_suggestion: 'Employee agrees not to directly compete with Employer within a 50-mile radius for a period of twelve (12) months following termination of employment.',
          }
        : {
            status: 'passed',
            critical_level: 'low',
            contract_snippet: snippet,
            description: 'Non-compete clause is present.',
            alternative_suggestion: '',
          };
    },
  };

  return rules.map((rule) => {
    const ruleKey = rule.title.toLowerCase();
    const patternKey = Object.keys(mockPatterns).find((k) => ruleKey.includes(k));
    const result = patternKey ? mockPatterns[patternKey](text, contractText) : generateGenericResult(text, rule);

    return {
      category: rule.title,
      status: result.status ?? 'missing',
      critical_level: result.critical_level ?? rule.severity,
      contract_snippet: result.contract_snippet ?? '',
      description: result.description ?? `No clause found matching rule: ${rule.title}.`,
      alternative_suggestion: result.alternative_suggestion ?? `Include a standard ${rule.title} clause as required by the playbook.`,
    } as AuditResultItem;
  });
}

function generateGenericResult(text: string, rule: PlaybookRule): Partial<AuditResultItem> {
  const keywords = rule.title.toLowerCase().split(' ').filter((w) => w.length > 4);
  const found = keywords.some((kw) => text.includes(kw));
  return found
    ? {
        status: 'passed',
        critical_level: 'low',
        description: `Clause for "${rule.title}" is present in the contract.`,
        alternative_suggestion: '',
      }
    : {
        status: 'missing',
        critical_level: rule.severity,
        description: `No clause found for "${rule.title}". ${rule.description}`,
        alternative_suggestion: `Include a comprehensive ${rule.title} clause that addresses: ${rule.description}`,
      };
}

function extractSnippet(text: string, keyword: string): string {
  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(keyword.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, text.lastIndexOf('\n', idx) + 1);
  const end = Math.min(text.length, text.indexOf('\n', idx + keyword.length));
  const snippet = text.slice(start, end === -1 ? Math.min(text.length, idx + 200) : end).trim();
  return snippet.slice(0, 300);
}
