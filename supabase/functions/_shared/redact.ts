// Reversible PII redaction applied to contract text *before* it is sent to
// any external LLM provider, per the zero-data-retention / GDPR-HIPAA
// requirement that raw PII never leaves our infrastructure boundary.
//
// Design: replace each PII match with a stable placeholder token
// (e.g. "[REDACTED_EMAIL_1]") and keep the token -> original-text mapping
// in memory only, for the lifetime of a single request. The LLM sees only
// placeholders; we substitute the real values back into whatever the LLM
// echoes (e.g. contract_snippet) before it is stored or shown to the user.
// The mapping itself is never persisted or logged.

export interface RedactionResult {
  redactedText: string;
  /** token -> original value, kept in memory only */
  mapping: Map<string, string>;
  counts: Record<string, number>;
}

interface PiiPattern {
  label: string;
  regex: RegExp;
}

// Order matters: more specific patterns (SSN, credit card) before looser
// ones (generic long-digit sequences) to avoid double-tagging.
const PII_PATTERNS: PiiPattern[] = [
  { label: "EMAIL", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { label: "SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    label: "CREDIT_CARD",
    regex: /\b(?:\d[ -]?){13,16}\b/g,
  },
  {
    label: "PHONE",
    regex: /\b(?:\+?\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g,
  },
  { label: "IP_ADDRESS", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  {
    // Simplistic US street-address heuristic — flags for human review rather
    // than claiming perfect recall; see docs/ROADMAP.md for the NER-based
    // upgrade path (e.g. a hosted PII-detection model) once volumes justify it.
    label: "STREET_ADDRESS",
    regex: /\b\d{1,5}\s+([A-Z][a-z]+\s){1,3}(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b/g,
  },
  { label: "DOB", regex: /\b(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(19|20)\d{2}\b/g },
];

export function redactPii(text: string): RedactionResult {
  const mapping = new Map<string, string>();
  const counts: Record<string, number> = {};
  let redacted = text;

  for (const { label, regex } of PII_PATTERNS) {
    redacted = redacted.replace(regex, (match) => {
      // Skip anything already inside a placeholder we just inserted.
      if (match.startsWith("[REDACTED_")) return match;
      counts[label] = (counts[label] ?? 0) + 1;
      const token = `[REDACTED_${label}_${counts[label]}]`;
      mapping.set(token, match);
      return token;
    });
  }

  return { redactedText: redacted, mapping, counts };
}

/** Reverse redaction on any string the LLM echoes back (e.g. a snippet). */
export function unredact(text: string, mapping: Map<string, string>): string {
  let out = text;
  for (const [token, original] of mapping) {
    out = out.split(token).join(original);
  }
  return out;
}

/** Apply unredact() to every string field of an audit-result-shaped object. */
export function unredactAuditItem<T extends Record<string, unknown>>(
  item: T,
  mapping: Map<string, string>
): T {
  const out: Record<string, unknown> = { ...item };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string") out[key] = unredact(value, mapping);
  }
  return out as T;
}
