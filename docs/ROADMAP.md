# ClauseGuard → Enterprise Roadmap

This document tracks everything from the enterprise readiness review that
was **not** shippable as working code in this pass, why, and how to build
it. Items already implemented are listed briefly at the top for context;
everything else is a phased plan with concrete library choices, since
"universal standard" enterprise features like SOC 2 attestation or a
Textract pipeline require infrastructure and account decisions, not just
code.

## Already implemented in this pass

| Area | What shipped | Where |
|---|---|---|
| Multi-tenancy | `organizations` table, `organization_id` on every tenant table, `auth_org_id()` helper, org-scoped RLS policies replacing user-scoped ones, storage folder keyed by org | `supabase/migrations/00002_multi_tenancy_and_rls_hardening.sql` |
| RLS tests | pgTAP suite: 2 fake orgs, verifies cross-tenant SELECT/UPDATE/INSERT all fail | `supabase/tests/rls.test.sql` (`supabase test db`) |
| PII redaction | Regex-based reversible redaction (email/SSN/card/phone/IP/address/DOB) before any text reaches Gemini; un-redacted before storage | `supabase/functions/_shared/redact.ts` |
| Structured outputs | Zod schema validates every LLM response; invalid JSON is rejected, not silently coerced | `supabase/functions/_shared/schemas.ts` |
| Model cascade | Fast model (`gemini-1.5-flash`) for the first pass; `gemini-1.5-pro` only re-verifies `flagged`+`high` items | `supabase/functions/run-audit/index.ts` |
| Env validation | Zod-validated env on both frontend boot and every edge function invocation — fails loud instead of `undefined` propagating | `src/lib/env.ts`, `supabase/functions/_shared/env.ts` |
| OOXML redlining | Real `<w:ins>`/`<w:del>` injection into `document.xml` via JSZip + DOMParser — genuine Word Track Changes, not a visual approximation | `src/lib/docx-redline.ts` |
| E2E scaffold | Credential-gated upload, document preview, and keyboard-navigation tests; these are not currently run by a CI workflow | `e2e/upload-scan-review-export.spec.ts` |

---

## Phase 1 (next sprint): close the gaps directly touching what shipped

1. **Secrets management** — `GOOGLE_API_KEY` currently lives as a plain
   Supabase Edge Function secret. Move it into **Supabase Vault**
   (`vault.create_secret`) and read it via `vault.decrypted_secrets` in the
   function instead of `Deno.env.get`, so key rotation doesn't require a
   redeploy and the value is encrypted at rest, not just access-controlled.
2. **Zero-data-retention agreement** — this is a *contractual*, not code,
   requirement: Google's standard Gemini API does **not** offer ZDR;
   Vertex AI (Google Cloud) and Azure OpenAI both do, with a signed
   customer agreement. Recommendation: migrate `run-audit` from the public
   Gemini API to **Vertex AI Gemini** (same model family, ZDR-eligible
   endpoint) — the `callGemini()` function in `run-audit/index.ts` is
   already isolated enough that this is a ~1-day swap of the fetch URL and
   auth header, not a rewrite.
3. **Redaction quality** — the current regex approach will miss names,
   free-text addresses without a street suffix, and non-US ID formats.
   Upgrade path: swap `redactPii()` internals for a hosted PII/NER model
   (e.g. Google Cloud DLP `deidentifyContent`, or AWS Comprehend PII
   detection) once contract volume justifies the added latency/cost — the
   function signature (`text -> {redactedText, mapping}`) is designed so
   swapping the implementation doesn't touch call sites.

## Phase 2: document processing engine

1. **Layout-aware parsing + OCR.** Currently only `text/plain` uploads are
   extracted. PDF and DOCX uploads have no parser, so audits now fail rather
   than claiming to analyze placeholder text. This is a release blocker for
   those formats. Recommended pipeline:
   - **Unstructured.io** (open-source, self-hostable, or hosted API) for
     layout-aware extraction of paragraphs/tables/headers from PDF & DOCX.
   - **AWS Textract** specifically for scanned/low-quality PDFs needing
     OCR — call it only when Unstructured reports low text-confidence or
     near-zero extracted characters, to avoid paying OCR cost on every
     upload.
2. **Async processing pipeline.** Do not run parsing/OCR/embedding inline
   inside a synchronous Edge Function invocation (current `run-audit`
   pattern) — Supabase Edge Functions have a request timeout, and OCR on a
   50-page contract will blow past it. Two realistic options, ranked by
   how much new infra they require:
   - **Supabase Queues (pgmq)** — Postgres-native queue, no new service to
     run, works well since you're already on Supabase. `pg_cron` triggers
     a worker Edge Function every N seconds to drain the queue.
   - **AWS SQS + a small worker (Lambda or ECS task)** — better if
     Textract is already in the pipeline (same AWS account, less
     cross-cloud latency), at the cost of a second infrastructure surface.
   Given the rest of the stack is Supabase-only, **start with pgmq** and
   only move to SQS if queue volume or OCR compute needs outgrow it.
3. **DOCX round-trip fidelity.** `src/lib/docx-redline.ts` (shipped) covers
   inserting tracked changes into an *existing* docx without touching
   styles/tables/headers, because it edits `document.xml` in place rather
   than regenerating the file. The remaining piece is wiring it end-to-end:
   frontend upload → store original `.docx` bytes in Storage (not just
   extracted text) → on export, fetch those bytes, run `applyRedlines()`
   with the accepted AI suggestions as edits, return the new file.
   Currently `contracts.file_url` exists but nothing writes the redlined
   output back — add a `redlined_file_url` column and an export button
   that calls this pipeline.

## Phase 3: AI reliability & evaluation

1. **LLM eval framework.** Recommendation: **Ragas** for RAG/extraction
   precision-recall (lightweight, Python, runs in CI) over TruLens/Braintrust
   for a team this size — fewer moving parts, no separate hosted service to
   pay for. Build a small golden-set: 15–20 contracts with human-labeled
   expected audit results per playbook rule, run `run-audit` against them
   in CI on every prompt/model change, fail the build if precision/recall
   on `flagged`/`missing` classification regresses beyond a threshold.
2. **Escalation policy tuning.** The model cascade currently escalates
   every `flagged`+`high` item unconditionally. Once the eval set exists,
   measure whether escalation actually changes the verdict often enough to
   justify the cost — if the fast model already agrees with the strong
   model >95% of the time on a rule category, drop that category from
   escalation.

## Phase 4: frontend UX

1. **Split-screen viewer.** Build a two-pane `react-resizable-panels`
   layout (already a dependency) — left pane renders the original PDF/DOCX
   (via `pdf.js` for PDF, or a docx→HTML preview for Word), right pane
   lists AI findings; clicking a finding scrolls/highlights the
   corresponding region in the left pane. This needs a stable way to map a
   `contract_snippet` back to a location in the rendered document — store
   character offsets (or page + bounding box, if using Textract in Phase 2)
   alongside each audit result rather than only the snippet text, so
   highlighting doesn't depend on fuzzy text search.
2. **WCAG 2.1 AA.** The repo already has `.rules/contrast.yml` and
   `.rules/require-button-interaction.yml` ast-grep checks running in
   `check.sh` (now wired into CI). Remaining work is a manual pass with
   `axe-core` (add `@axe-core/playwright` and assert zero violations in the
   E2E suite) plus a keyboard-navigation and screen-reader pass on the new
   split-screen viewer specifically, since custom highlighting/scroll-sync
   widgets are the most common place AA compliance breaks.
3. **TanStack Query.** Not yet introduced — `src/services/api.ts` currently
   calls Supabase directly from components. Wrapping these calls in
   TanStack Query gets caching, optimistic updates, and graceful
   loading/error/offline states largely for free; worth doing before the
   split-screen viewer adds more async state to manage by hand.

## Phase 5: observability

1. **LLM tracing.** Recommendation: **Helicone** — it's a drop-in proxy
   (change the Gemini base URL to Helicone's, add one header) rather than
   an SDK you instrument every call with, which fits the current
   `callGemini()` fetch-based design with near-zero code change. Gives
   latency, cost/document, and token consumption immediately; add custom
   properties (`contract_id`, `organization_id`, `model` from the cascade)
   for per-tenant cost breakdowns.
2. **Hallucination rate.** Track this as a Phase 3 eval metric
   (`contract_snippet` exact-match-in-source-text rate) rather than a
   separate observability tool — it's a correctness metric, not a
   performance one, and the schema already validates format; add a runtime
   check that flags (but doesn't reject) any `contract_snippet` that isn't
   a substring of the original contract text, and pipe that flag into
   Helicone as a custom property to trend over time.

## Explicitly out of scope for now (revisit if/when relevant)

- **SOC 2 Type II attestation** — a compliance audit process, not
  something to code; relevant once Phase 1–2 security controls are live
  and there's a paying enterprise customer requiring it.
- **HIPAA** — only relevant if ClauseGuard ever processes contracts
  containing PHI; if so, a signed BAA with the LLM provider becomes
  mandatory in addition to the ZDR agreement in Phase 1.
