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
SELECT plan(48);

-- API grants allow requests to reach RLS; they do not grant cross-tenant
-- row access.
SELECT ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated can read profiles');
SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'INSERT'),
  'authenticated cannot create profiles directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'authenticated cannot change organization membership directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.organization_invites', 'SELECT'),
  'authenticated cannot read stored organization invite hashes');
SELECT ok(has_function_privilege('authenticated', 'public.create_organization_invite(integer,integer)', 'EXECUTE'),
  'authenticated can request an organization invite through the owner-checked function');
SELECT ok(has_table_privilege('anon', 'public.playbooks', 'SELECT'),
  'anonymous clients can read system playbooks');
SELECT ok(has_table_privilege('authenticated', 'public.playbooks', 'SELECT'),
  'authenticated can read playbooks');
SELECT ok(has_table_privilege('authenticated', 'public.playbooks', 'INSERT'),
  'authenticated can insert playbooks');
SELECT ok(has_table_privilege('authenticated', 'public.playbooks', 'UPDATE'),
  'authenticated can update playbooks');
SELECT ok(has_table_privilege('authenticated', 'public.playbooks', 'DELETE'),
  'authenticated can delete playbooks');
SELECT ok(has_table_privilege('authenticated', 'public.contracts', 'SELECT'),
  'authenticated can read contracts');
SELECT ok(NOT has_table_privilege('authenticated', 'public.contracts', 'INSERT'),
  'authenticated cannot bypass audit credit reservation when inserting contracts');
SELECT ok(has_function_privilege('authenticated',
  'public.create_contract_for_audit(text,text,text,uuid)', 'EXECUTE'),
  'authenticated can create contracts through the quota-enforcing function');
SELECT ok(has_function_privilege('authenticated', 'public.get_audit_usage()', 'EXECUTE'),
  'authenticated can read organization usage');
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_contract_audit(uuid)', 'EXECUTE'),
  'authenticated cannot claim audits directly');
SELECT ok(has_function_privilege('service_role', 'public.claim_contract_audit(uuid)', 'EXECUTE'),
  'the audit edge function can claim audits');
SELECT ok(has_table_privilege('authenticated', 'public.contract_versions', 'SELECT'),
  'authenticated can read revisions in their organization');
SELECT ok(has_table_privilege('authenticated', 'public.contract_versions', 'INSERT'),
  'authenticated can add revisions in their organization');
SELECT ok(NOT has_table_privilege('authenticated', 'public.contracts', 'UPDATE'),
  'authenticated cannot alter audit state or bypass usage accounting');
SELECT ok(has_table_privilege('authenticated', 'public.contracts', 'DELETE'),
  'authenticated can delete contracts');
SELECT ok(has_table_privilege('authenticated', 'public.audit_results', 'SELECT'),
  'authenticated can read audit results');
SELECT ok(NOT has_table_privilege('authenticated', 'public.audit_results', 'INSERT'),
  'authenticated cannot write audit results directly');
SELECT ok(has_function_privilege('authenticated', 'public.auth_org_id()', 'EXECUTE'),
  'authenticated can evaluate organization-scoped RLS policies');
SELECT ok(has_function_privilege('anon', 'public.auth_org_id()', 'EXECUTE'),
  'anonymous clients can evaluate playbook RLS policies');

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
UPDATE organizations SET owner_id = '11111111-1111-1111-1111-111111111111'
  WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
UPDATE organizations SET plan_tier = 'pro', billing_status = 'active'
  WHERE id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
CREATE TEMP TABLE test_organization_invite AS
  SELECT public.create_organization_invite(7, 1) AS code;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('33333333-3333-3333-3333-333333333333', 'charlie@org-a.test',
   jsonb_build_object('organization_invite_code', (SELECT code FROM test_organization_invite)));

SELECT is(
  (SELECT organization_id FROM profiles WHERE id = '33333333-3333-3333-3333-333333333333'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'a valid invite joins the new user to the existing organization'
);

SELECT throws_ok(
  $$ INSERT INTO auth.users (id, email, raw_user_meta_data)
     VALUES ('44444444-4444-4444-4444-444444444444', 'dana@org-a.test',
             jsonb_build_object('organization_invite_code', (SELECT code FROM test_organization_invite))) $$,
  NULL, NULL,
  'a single-use organization invite cannot be reused'
);

INSERT INTO playbooks (id, user_id, organization_id, name, rules_json, is_system) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org A Playbook', '[]'::jsonb, false),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Org B Playbook', '[]'::jsonb, false);

INSERT INTO contracts (id, user_id, organization_id, file_name, playbook_id) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'org-a-nda.pdf', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('abababab-abab-abab-abab-abababababab', '33333333-3333-3333-3333-333333333333',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'org-a-shared.pdf', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'org-b-msa.pdf', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

UPDATE organizations
SET plan_tier = 'free', billing_status = 'free', free_audits_used = 0, monthly_audits_used = 0
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

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
  2,
  'Alice sees contracts uploaded by members of her organization, not Org B''s'
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

SELECT throws_ok(
  $$ INSERT INTO contracts (user_id, organization_id, file_name, playbook_id)
     VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             'foreign-playbook.pdf', 'dddddddd-dddd-dddd-dddd-dddddddddddd') $$,
  NULL, NULL,
  'Alice cannot attach Org B''s playbook to an Org A contract'
);

-- ---- Invited teammate (Org A) -------------------------------------------
SET LOCAL request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

SELECT is(
  (SELECT count(*)::int FROM contracts),
  2,
  'an invited teammate can view shared contracts in the joined organization'
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

SELECT is(
  (public.get_audit_usage()->>'free_audits_remaining')::int,
  3,
  'a new free organization receives three audit credits'
);

SELECT lives_ok(
  $$ SELECT public.create_contract_for_audit(
       'first.txt',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/first.txt',
       'first contract text'
     ) $$,
  'a contract upload atomically reserves one free audit'
);
SELECT is(
  (public.get_audit_usage()->>'free_audits_remaining')::int,
  2,
  'one upload consumes exactly one free audit credit'
);
SELECT lives_ok(
  $$ SELECT public.create_contract_for_audit(
       'second.txt',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/second.txt',
       'second contract text'
     ) $$,
  'the second free contract upload succeeds'
);
SELECT lives_ok(
  $$ SELECT public.create_contract_for_audit(
       'third.txt',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/third.txt',
       'third contract text'
     ) $$,
  'the third free contract upload succeeds'
);
SELECT is(
  (public.get_audit_usage()->>'free_audits_remaining')::int,
  0,
  'three free uploads exhaust the trial credits'
);
SELECT throws_ok(
  $$ SELECT public.create_contract_for_audit(
       'fourth.txt',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/fourth.txt',
       'fourth contract text'
     ) $$,
  NULL, NULL,
  'a fourth upload is rejected after the free credits are exhausted'
);

SELECT * FROM finish();
ROLLBACK;
