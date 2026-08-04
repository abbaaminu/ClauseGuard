-- ============================================================================
-- RLS / multi-tenancy regression tests (pgTAP)
--
-- Run with the Supabase CLI:
--   supabase test db
--
-- These tests spin up two fake organizations (A and B), each with their own
-- user, playbook, contract, and audit result, then assert — as each user —
-- that rows belonging to the *other* organization are completely invisible,
-- both for SELECT and for write attempts.
-- ============================================================================
BEGIN;
SELECT plan(13);

-- ---- Fixtures -----------------------------------------------------------
INSERT INTO organizations (id, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Org B');

-- Inserting into auth.users fires handle_new_user(), which auto-creates a
-- profile tied to a freshly-minted (random-id) organization of its own.
-- That's the correct production behavior for real signups, but it means
-- our fixture can't pre-assign these two users to Org A / Org B via a
-- plain INSERT — the trigger's row already exists by the time we'd try.
-- So: let the trigger run, then reassign each profile to our fixed test
-- organization, exactly as an "invite user to existing org" flow would.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'alice@org-a.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@org-b.test');

UPDATE profiles SET organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', organization_name = 'Org A'
  WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE profiles SET organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', organization_name = 'Org B'
  WHERE id = '22222222-2222-2222-2222-222222222222';

INSERT INTO playbooks (id, user_id, organization_id, name, rules_json, is_system) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org A Playbook', '[]'::jsonb, false),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Org B Playbook', '[]'::jsonb, false);

INSERT INTO contracts (id, user_id, organization_id, file_name, playbook_id) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'org-a-nda.pdf', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'org-b-msa.pdf', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

-- audit_results.organization_id is stamped by trigger; insert as service_role
SET LOCAL ROLE service_role;
INSERT INTO audit_results (id, contract_id, category, status, critical_level) VALUES
  ('11111111-2222-3333-4444-555555555555', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Governing Law', 'passed', 'low'),
  ('66666666-7777-8888-9999-aaaaaaaaaaaa', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Governing Law', 'flagged', 'high');
RESET ROLE;

-- System playbooks are seeded by migrations (run as an unrestricted role),
-- never inserted by a regular authenticated user — see migration 00001's
-- own seed data for the real-world equivalent of this insert.
INSERT INTO playbooks (id, user_id, organization_id, name, rules_json, is_system) VALUES
  ('99999999-9999-9999-9999-999999999999', NULL, NULL, 'System Playbook', '[]'::jsonb, true);

-- ---- As Alice (Org A) -----------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

SELECT is(
  (SELECT count(*)::int FROM contracts),
  1,
  'Alice sees exactly her own org''s contract, not Org B''s'
);

SELECT is(
  (SELECT file_name FROM contracts LIMIT 1),
  'org-a-nda.pdf',
  'Alice''s visible contract is the Org A one'
);

SELECT is(
  (SELECT count(*)::int FROM playbooks WHERE is_system = false),
  1,
  'Alice sees only Org A''s non-system playbook'
);

SELECT is(
  (SELECT count(*)::int FROM audit_results),
  1,
  'Alice sees only audit results tied to her org''s contract'
);

-- Cross-tenant read-by-id must return zero rows, not an error
SELECT is(
  (SELECT count(*)::int FROM contracts WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  0,
  'Alice cannot read Org B''s contract by direct id lookup'
);

SELECT is(
  (SELECT count(*)::int FROM audit_results WHERE id = '66666666-7777-8888-9999-aaaaaaaaaaaa'),
  0,
  'Alice cannot read Org B''s audit result by direct id lookup'
);

-- Cross-tenant writes must be silently filtered by RLS (0 rows affected),
-- not merely blocked with an exception — an UPDATE ... WHERE that matches
-- no visible row is not an error in Postgres, it's a no-op. Run the
-- attempt as its own top-level statement (pgTAP/PL can't capture its row
-- count inline), then prove the no-op with an unrestricted-role read.
UPDATE contracts SET file_name = 'hacked.pdf' WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- Verify with an unrestricted role (RLS bypassed) that Org B's contract
-- truly wasn't touched — checking as Alice would just show NULL again
-- because she still can't see the row, which would prove nothing.
RESET ROLE;
SELECT is(
  (SELECT file_name FROM contracts WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff')::text,
  'org-b-msa.pdf',
  'Org B''s contract is untouched after Alice''s blocked update attempt'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

SELECT throws_ok(
  $$ INSERT INTO contracts (user_id, organization_id, file_name)
     VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sneaky.pdf') $$,
  NULL, NULL,
  'Alice cannot insert a contract tagged with Org B''s organization_id'
);

-- ---- As Bob (Org B) ---------------------------------------------------
SET LOCAL request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

SELECT is(
  (SELECT count(*)::int FROM contracts),
  1,
  'Bob sees exactly his own org''s contract'
);

SELECT is(
  (SELECT file_name FROM contracts LIMIT 1),
  'org-b-msa.pdf',
  'Bob''s visible contract is the Org B one'
);

SELECT is(
  (SELECT count(*)::int FROM contracts WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  0,
  'Bob cannot read Org A''s contract by direct id lookup'
);

-- ---- System playbooks remain visible to everyone -----------------------
-- (Migration 00001 already seeds 4 system playbooks; check for the
-- fixture's own one by name rather than an exact total count, so this
-- test doesn't break every time the seed data changes.)
SELECT is(
  (SELECT count(*)::int FROM playbooks WHERE is_system = true AND name = 'System Playbook'),
  1,
  'Bob can see system playbooks regardless of organization'
);

SELECT is(
  (SELECT count(*)::int FROM playbooks WHERE name = 'Org A Playbook'),
  0,
  'Bob cannot see Org A''s private playbook'
);

SELECT * FROM finish();
ROLLBACK;
