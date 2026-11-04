begin;

select no_plan();

-- The helper deliberately supplies the ordinary authenticated claim.  Tests that
-- pass a different app_role prove that policies do not trust that claim.
create or replace function pg_temp.set_actor(
  p_actor uuid,
  p_app_role text default 'authenticated'
) returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_actor::text, 'app_role', p_app_role)::text,
    true
  );
$$;
grant execute on function pg_temp.set_actor(uuid, text) to authenticated;

-- Fixture setup is intentionally performed as postgres.  The auth trigger gets
-- a metadata role of admin here; the profile update below is the authoritative
-- role assignment under test.
reset role;
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000101', 'guardian1@example.invalid', '{"role":"admin"}'::jsonb),
  ('00000000-0000-0000-0000-000000000102', 'guardian2@example.invalid', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000201', 'specialist1@example.invalid', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000202', 'specialist2@example.invalid', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000301', 'examiner1@example.invalid', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000401', 'admin1@example.invalid', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000501', 'metadata-role@example.invalid', '{"role":"admin"}'::jsonb)
on conflict (id) do nothing;

select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-000000000501'), 'guardian', 'auth trigger defaults profile role to guardian, ignoring metadata');

update public.profiles
set role = v.role, display_name = v.display_name
from (values
  ('00000000-0000-0000-0000-000000000101'::uuid, 'guardian', 'ولي ١'),
  ('00000000-0000-0000-0000-000000000102'::uuid, 'guardian', 'ولي ٢'),
  ('00000000-0000-0000-0000-000000000201'::uuid, 'specialist', 'أخصائي ١'),
  ('00000000-0000-0000-0000-000000000202'::uuid, 'specialist', 'أخصائي ٢'),
  ('00000000-0000-0000-0000-000000000301'::uuid, 'examiner', 'فاحص ١'),
  ('00000000-0000-0000-0000-000000000401'::uuid, 'admin', 'مدير ١')
) as v(id, role, display_name)
where profiles.id = v.id;

insert into public.children
  (id, first_name, grade, birth_month, dialect_lexicon_id, guardian_id, specialist_id, is_demo)
values
  ('00000000-0000-0000-0000-000000001001', 'ليان (ملف تجريبي)', 2, '2017-02', 'kw',
   '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201', true),
  ('00000000-0000-0000-0000-000000001002', 'سالم (ملف تجريبي)', 4, '2015-09', 'msa',
   '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000202', true)
on conflict (id) do nothing;

insert into public.consents
  (id, child_id, guardian_id, specialist_id, scope, signed_at, expires_at, evidence_path, ethics_ref)
values
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000001001',
   '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201',
   'assessment', now() - interval '1 day', now() + interval '30 days', 'fixture/consent-1-assessment', 'fixture-ethics-1'),
  ('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000001001',
   '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201',
   'practice', now() - interval '1 day', now() + interval '30 days', 'fixture/consent-1-practice', 'fixture-ethics-1'),
  ('00000000-0000-0000-0000-000000002004', '00000000-0000-0000-0000-000000001002',
   '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000202',
   'assessment', now() - interval '1 day', now() + interval '30 days', 'fixture/consent-2-assessment', 'fixture-ethics-2')
on conflict (id) do nothing;

-- API-shaped session fixtures.  The trigger must force the initial state and
-- server start timestamp, and must not accept the forged relationship actor.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
set local role authenticated;
insert into public.sessions (id, child_id, type, status, started_at, ended_at, run_by)
values
  ('00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000001001',
   'assessment', 'in_progress', now() - interval '3 days', null,
   '00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000001001',
   'practice', 'in_progress', now() - interval '2 days', null,
   '00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000003004', '00000000-0000-0000-0000-000000001001',
   'probe', 'in_progress', now() - interval '1 hour', null,
   '00000000-0000-0000-0000-000000000201');
select pg_temp.set_actor('00000000-0000-0000-0000-000000000301');
insert into public.sessions (id, child_id, type, status, started_at, ended_at, run_by)
values ('00000000-0000-0000-0000-000000003003', '00000000-0000-0000-0000-000000001001',
        'stage0', 'in_progress', now() - interval '1 day', null,
        '00000000-0000-0000-0000-000000000301');

-- A compact, contract-shaped score response.  The database deliberately does
-- not duplicate the full B5 validator; unchanged JSON is asserted below.
reset role;
create or replace function pg_temp.score_response(p_item text, p_synthetic boolean default true)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'item_id', p_item, 'item_type', 'real_word', 'model_version', 'fixture-1',
    'synthetic', p_synthetic, 'audio_duration_ms', 420, 'words', '[]'::jsonb,
    'phonemes', '[]'::jsonb, 'skill_evidence', jsonb_build_array(
      jsonb_build_object('skill_id', 'ls.alif', 'correct', true, 'source', 'audio')
    ), 'wcpm', null, 'warnings', '[]'::jsonb
  );
$$;

create or replace function pg_temp.fingerprint_response(p_session uuid)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'session_id', p_session::text, 'model_version', 'fixture-1', 'rules_version', 'fixture-rules',
    'synthetic', true,
    'features', jsonb_build_object(
      'dot_confusion_rate', 0, 'emphatic_confusion_rate', 0, 'short_vowel_error_rate', 0,
      'positional_error_rate', 0, 'omission_rate', 0, 'insertion_rate', 0,
      'substitution_rate', 0, 'wcpm', null, 'self_correction_rate', null,
      'pseudoword_gap', null, 'vowelization_gap', null
    ),
    'referral', jsonb_build_object('decision', 'no_referral_indicated', 'rules_fired', '[]'::jsonb),
    'review_status', 'pending_review'
  );
$$;

set local role authenticated;
select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
insert into public.item_results (id, session_id, item_id, response, audio_path, audio_expires_at, synthetic)
values ('00000000-0000-0000-0000-000000004001', '00000000-0000-0000-0000-000000003001',
        'fixture-item', pg_temp.score_response('fixture-item'),
        'audio/00000000-0000-0000-0000-000000001001/00000000-0000-0000-0000-000000003001/fixture-item.wav',
        now() + interval '30 days', true);
insert into public.tap_results (id, session_id, item_id, evidence)
values ('00000000-0000-0000-0000-000000004002', '00000000-0000-0000-0000-000000003002',
        'fixture-tap', '{"skill_id":"vowel.short_a","correct":true,"source":"tap"}'::jsonb);
insert into public.fingerprints (id, session_id, response)
values ('00000000-0000-0000-0000-000000004003', '00000000-0000-0000-0000-000000003001',
        pg_temp.fingerprint_response('00000000-0000-0000-0000-000000003001'));
insert into public.skill_mastery (child_id, skill_id, mastery, updated_at, source_session_id)
values ('00000000-0000-0000-0000-000000001001', 'ls.alif', 0.5, now(),
        '00000000-0000-0000-0000-000000003002');

-- Role helpers are profile-backed, not JWT-backed.
select is(basira_private.current_role(), 'specialist', 'current_role reads profiles.role');
select ok(not basira_private.is_admin(), 'specialist is not admin');
select ok(basira_private.can_manage_child('00000000-0000-0000-0000-000000001001'), 'assigned specialist manages child');
select ok(basira_private.can_access_session('00000000-0000-0000-0000-000000003001'), 'assigned specialist accesses session');
select ok(basira_private.has_consent('00000000-0000-0000-0000-000000001001', 'assessment'), 'active assessment consent is valid');
select ok(basira_private.has_consent('00000000-0000-0000-0000-000000001001', 'practice'), 'active practice consent is valid');
select ok(not basira_private.has_consent('00000000-0000-0000-0000-000000001001', 'probe', now() + interval '90 days'), 'future probe time has no valid consent');

select pg_temp.set_actor('00000000-0000-0000-0000-000000000101');
select is(basira_private.current_role(), 'guardian', 'current_role ignores stale specialist claim');
select ok(not basira_private.is_admin(), 'guardian is not admin');
select ok(not basira_private.can_manage_child('00000000-0000-0000-0000-000000001001'), 'guardian cannot manage child');
select ok(basira_private.has_consent('00000000-0000-0000-0000-000000001001', 'assessment'), 'guardian sees own active consent');

select pg_temp.set_actor('00000000-0000-0000-0000-000000000101', 'admin');
select is(basira_private.current_role(), 'guardian', 'stale JWT admin claim cannot self-escalate');
select ok(not basira_private.is_admin(), 'stale JWT admin claim is not privileged');

select pg_temp.set_actor('00000000-0000-0000-0000-000000000999');
select is(basira_private.current_role(), null, 'user without profile has no application role');
select is((select count(*)::int from public.children), 0, 'user without profile sees no children');
select is((select count(*)::int from public.sessions), 0, 'user without profile sees no sessions');

-- Cross-family and unassigned specialist isolation.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000102');
select is((select count(*)::int from public.children), 1, 'guardian sees only own child');
select is((select count(*)::int from public.children where id = '00000000-0000-0000-0000-000000001001'), 0, 'guardian cannot see another family');
select is((select count(*)::int from public.item_results), 0, 'guardian cannot read raw item results');
select is((select count(*)::int from public.tap_results), 0, 'guardian cannot read raw tap results');
select is((select count(*)::int from public.skill_mastery), 0, 'guardian cannot read raw mastery');

select pg_temp.set_actor('00000000-0000-0000-0000-000000000202');
select is((select count(*)::int from public.children), 1, 'specialist sees only assigned children');
select is((select count(*)::int from public.children where id = '00000000-0000-0000-0000-000000001001'), 0, 'unassigned specialist cannot see child');
select is((select count(*)::int from public.sessions where child_id = '00000000-0000-0000-0000-000000001001'), 0, 'unassigned specialist cannot see session');

-- Guardian consent ownership, relational actor checks, and revoke-by-shortening.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000101');
select throws_ok($$insert into public.consents (child_id, guardian_id, specialist_id, scope, signed_at, expires_at, evidence_path, ethics_ref)
  values ('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201', 'assessment', now(), now() + interval '1 day', 'x', 'e')$$, NULL::text, NULL::text, 'guardian cannot consent for another child');
select throws_ok($$insert into public.consents (child_id, guardian_id, specialist_id, scope, signed_at, expires_at, evidence_path, ethics_ref)
  values ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000202', 'assessment', now(), now() + interval '1 day', 'x', 'e')$$, NULL::text, NULL::text, 'consent specialist must match child');
select lives_ok($$insert into public.consents (child_id, guardian_id, specialist_id, scope, signed_at, expires_at, evidence_path, ethics_ref)
  values ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201', 'assessment', now() + interval '1 hour', now() + interval '1 day', 'x', 'e')$$, 'consent signature time is server-controlled');
select ok((select signed_at > clock_timestamp() - interval '1 minute' and signed_at <= clock_timestamp()
  from public.consents
  where child_id = '00000000-0000-0000-0000-000000001001'
    and guardian_id = '00000000-0000-0000-0000-000000000101'
    and specialist_id = '00000000-0000-0000-0000-000000000201'
    and evidence_path = 'x'), 'inserted consent uses the actual server signature time');
select lives_ok($$update public.consents
  set expires_at = clock_timestamp()
  where child_id = '00000000-0000-0000-0000-000000001001'
    and guardian_id = '00000000-0000-0000-0000-000000000101'
    and specialist_id = '00000000-0000-0000-0000-000000000201'
    and evidence_path = 'x'$$, 'fixture consent can be revoked before denial checks');
reset role;
delete from public.consents
where child_id = '00000000-0000-0000-0000-000000001001'
  and guardian_id = '00000000-0000-0000-0000-000000000101'
  and specialist_id = '00000000-0000-0000-0000-000000000201'
  and evidence_path = 'x';
set local role authenticated;
select throws_ok($$update public.consents set scope = 'audio_research' where id = '00000000-0000-0000-0000-000000002001'$$, NULL::text, NULL::text, 'guardian cannot rewrite consent scope');
select throws_ok($$update public.consents set child_id = '00000000-0000-0000-0000-000000001002' where id = '00000000-0000-0000-0000-000000002001'$$, NULL::text, NULL::text, 'guardian cannot rewrite consent child');
select throws_ok($$update public.consents set signed_at = now() - interval '2 days' where id = '00000000-0000-0000-0000-000000002001'$$, NULL::text, NULL::text, 'guardian cannot rewrite consent signature time');
select throws_ok($$update public.consents set guardian_id = '00000000-0000-0000-0000-000000000102' where id = '00000000-0000-0000-0000-000000002001'$$, NULL::text, NULL::text, 'guardian cannot rewrite consent guardian actor');
select throws_ok($$update public.consents set specialist_id = '00000000-0000-0000-0000-000000000202' where id = '00000000-0000-0000-0000-000000002001'$$, NULL::text, NULL::text, 'guardian cannot rewrite consent specialist actor');
select throws_ok($$update public.consents set expires_at = now() + interval '1 year' where id = '00000000-0000-0000-0000-000000002001'$$, NULL::text, NULL::text, 'guardian may not extend consent expiry');
select lives_ok($$update public.consents set expires_at = now() where id = '00000000-0000-0000-0000-000000002001'$$, 'guardian may revoke by shortening expiry');
select is((select expires_at <= clock_timestamp() from public.consents where id = '00000000-0000-0000-0000-000000002001'), true, 'revoked consent is shortened');
select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
select throws_ok($$insert into public.consents (child_id, guardian_id, specialist_id, scope, signed_at, expires_at, evidence_path, ethics_ref)
  values ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201', 'assessment', now(), now() + interval '1 day', 'x', 'e')$$, NULL::text, NULL::text, 'specialist cannot sign guardian consent');

-- Restore the fixture consent as postgres for the remainder of the suite.
reset role;
-- Privileged test-fixture restoration only; never an application permission.
alter table public.consents disable trigger guard_consent;
update public.consents set expires_at = now() + interval '30 days' where id = '00000000-0000-0000-0000-000000002001';
alter table public.consents enable trigger guard_consent;

-- Consent is tied to the session type; audio_research is not a session consent.
reset role;
update public.consents set expires_at = now() - interval '1 minute' where id = '00000000-0000-0000-0000-000000002001';
select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
set local role authenticated;
select throws_ok($$insert into public.sessions (child_id, type, run_by) values ('00000000-0000-0000-0000-000000001001', 'assessment', '00000000-0000-0000-0000-000000000201')$$, NULL::text, NULL::text, 'session with no valid consent is denied');
select throws_ok($$insert into public.sessions (child_id, type, run_by) values ('00000000-0000-0000-0000-000000001001', 'probe', '00000000-0000-0000-0000-000000000201')$$, NULL::text, NULL::text, 'probe without assessment consent is denied');
select lives_ok($$insert into public.sessions (child_id, type, run_by) values ('00000000-0000-0000-0000-000000001001', 'practice', '00000000-0000-0000-0000-000000000201')$$, 'practice uses practice consent, not assessment consent');
select throws_ok($$insert into public.sessions (child_id, type, run_by) values ('00000000-0000-0000-0000-000000001001', 'research', '00000000-0000-0000-0000-000000000201')$$, NULL::text, NULL::text, 'research cannot start sessions');
reset role;
-- Privileged test-fixture restoration only; never an application permission.
alter table public.consents disable trigger guard_consent;
update public.consents set expires_at = now() + interval '30 days' where id = '00000000-0000-0000-0000-000000002001';
alter table public.consents enable trigger guard_consent;

-- A guardian cannot run sessions. An examiner can create only their own
-- Stage 0 session; access remains limited to explicitly assigned rows.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000101');
set local role authenticated;
select throws_ok($$insert into public.sessions (child_id, type, run_by) values ('00000000-0000-0000-0000-000000001001', 'practice', '00000000-0000-0000-0000-000000000101')$$, NULL::text, NULL::text, 'guardian cannot run a session');
select pg_temp.set_actor('00000000-0000-0000-0000-000000000301');
select lives_ok($$insert into public.sessions (child_id, type, run_by) values ('00000000-0000-0000-0000-000000001001', 'stage0', '00000000-0000-0000-0000-000000000301')$$, 'examiner can insert their own Stage 0 session');
select is((select count(*)::int from public.sessions where id = '00000000-0000-0000-0000-000000003003'), 1, 'assigned examiner sees own stage0 session');
select is((select count(*)::int from public.sessions where id = '00000000-0000-0000-0000-000000003001'), 0, 'examiner cannot see unassigned session');

-- Initial state and server timestamp invariants.
reset role;
select is((select status::text from public.sessions where id = '00000000-0000-0000-0000-000000003001'), 'in_progress', 'session status starts in_progress');
select ok((select started_at > now() - interval '1 minute' from public.sessions where id = '00000000-0000-0000-0000-000000003001'), 'started_at is server time');
select is((select ended_at from public.sessions where id = '00000000-0000-0000-0000-000000003001'), null, 'new session has no ended_at');
select is((select run_by from public.sessions where id = '00000000-0000-0000-0000-000000003001'), '00000000-0000-0000-0000-000000000201'::uuid, 'run_by is not client-spoofable');
select is((select audio_path from public.item_results where id = '00000000-0000-0000-0000-000000004001'), 'audio/00000000-0000-0000-0000-000000001001/00000000-0000-0000-0000-000000003001/fixture-item.wav', 'audio path is canonical child/session/item path');

select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
set local role authenticated;
select throws_ok($$insert into public.sessions (id, child_id, type, status, started_at, ended_at, run_by)
  values ('00000000-0000-0000-0000-000000003005', '00000000-0000-0000-0000-000000001001', 'assessment', 'completed', now() - interval '3 days', now() - interval '2 days', '00000000-0000-0000-0000-000000000201')$$, NULL::text, NULL::text, 'session cannot be inserted completed');
select throws_ok($$insert into public.sessions (id, child_id, type, status, started_at, ended_at, run_by)
  values ('00000000-0000-0000-0000-000000003006', '00000000-0000-0000-0000-000000001001', 'assessment', 'in_progress', now() - interval '3 days', null, '00000000-0000-0000-0000-000000000101')$$, NULL::text, NULL::text, 'session run_by cannot be forged as guardian');

select throws_ok($$update public.sessions set child_id = '00000000-0000-0000-0000-000000001002' where id = '00000000-0000-0000-0000-000000003001'$$, NULL::text, NULL::text, 'session child relationship is immutable');
select throws_ok($$update public.sessions set type = 'practice' where id = '00000000-0000-0000-0000-000000003001'$$, NULL::text, NULL::text, 'session type is immutable');
select throws_ok($$update public.sessions set run_by = '00000000-0000-0000-0000-000000000101' where id = '00000000-0000-0000-0000-000000003001'$$, NULL::text, NULL::text, 'session actor is immutable');
select throws_ok($$update public.sessions set started_at = now() - interval '1 year' where id = '00000000-0000-0000-0000-000000003001'$$, NULL::text, NULL::text, 'session start timestamp is immutable');
select lives_ok($$update public.sessions set status = 'completed' where id = '00000000-0000-0000-0000-000000003001'$$, 'session can complete through the state transition');
select ok((select ended_at > started_at and ended_at <= clock_timestamp() from public.sessions where id = '00000000-0000-0000-0000-000000003001'), 'completion timestamp is server time');
select throws_ok($$update public.sessions set status = 'in_progress' where id = '00000000-0000-0000-0000-000000003001'$$, NULL::text, NULL::text, 'terminal session cannot be reopened');
select pg_temp.set_actor('00000000-0000-0000-0000-000000000101');
select throws_ok($$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000101'$$, NULL::text, NULL::text, 'profile edit cannot promote guardian');

-- RLS is enabled on every canonical public table, and anon has no table grant.
reset role;
select has_column('public', 'profiles', 'id', 'profiles.id exists');
select has_column('public', 'profiles', 'role', 'profiles.role exists');
select has_column('public', 'profiles', 'display_name', 'profiles.display_name exists');
select has_column('public', 'children', 'id', 'children.id exists');
select has_column('public', 'children', 'first_name', 'children.first_name exists');
select has_column('public', 'children', 'grade', 'children.grade exists');
select has_column('public', 'children', 'birth_month', 'children.birth_month exists');
select has_column('public', 'children', 'dialect_lexicon_id', 'children.dialect_lexicon_id exists');
select has_column('public', 'children', 'guardian_id', 'children.guardian_id exists');
select has_column('public', 'children', 'specialist_id', 'children.specialist_id exists');
select has_column('public', 'children', 'is_demo', 'children.is_demo exists');
select has_column('public', 'consents', 'id', 'consents.id exists');
select has_column('public', 'consents', 'child_id', 'consents.child_id exists');
select has_column('public', 'consents', 'guardian_id', 'consents.guardian_id exists');
select has_column('public', 'consents', 'specialist_id', 'consents.specialist_id exists');
select has_column('public', 'consents', 'scope', 'consents.scope exists');
select has_column('public', 'consents', 'signed_at', 'consents.signed_at exists');
select has_column('public', 'consents', 'expires_at', 'consents.expires_at exists');
select has_column('public', 'sessions', 'id', 'sessions.id exists');
select has_column('public', 'sessions', 'child_id', 'sessions.child_id exists');
select has_column('public', 'sessions', 'type', 'sessions.type exists');
select has_column('public', 'sessions', 'status', 'sessions.status exists');
select has_column('public', 'sessions', 'started_at', 'sessions.started_at exists');
select has_column('public', 'sessions', 'ended_at', 'sessions.ended_at exists');
select has_column('public', 'sessions', 'run_by', 'sessions.run_by exists');
select has_column('public', 'item_results', 'response', 'item_results.response exists');
select has_column('public', 'item_results', 'audio_path', 'item_results.audio_path exists');
select has_column('public', 'item_results', 'audio_expires_at', 'item_results.audio_expires_at exists');
select has_column('public', 'item_results', 'synthetic', 'item_results.synthetic exists');
select has_column('public', 'tap_results', 'evidence', 'tap_results.evidence exists');
select has_column('public', 'fingerprints', 'response', 'fingerprints.response exists');
select has_column('public', 'fingerprints', 'review_status', 'fingerprints.review_status exists');
select has_column('public', 'fingerprints', 'reviewed_by', 'fingerprints.reviewed_by exists');
select has_column('public', 'fingerprints', 'reviewed_at', 'fingerprints.reviewed_at exists');
select has_column('public', 'skill_mastery', 'child_id', 'skill_mastery.child_id exists');
select has_column('public', 'skill_mastery', 'skill_id', 'skill_mastery.skill_id exists');
select has_column('public', 'skill_mastery', 'mastery', 'skill_mastery.mastery exists');
select has_column('public', 'skill_mastery', 'updated_at', 'skill_mastery.updated_at exists');
select has_column('public', 'skill_mastery', 'source_session_id', 'skill_mastery.source_session_id exists');
select has_column('public', 'plans', 'skill_ids', 'plans.skill_ids exists');
select has_column('public', 'plans', 'item_ids', 'plans.item_ids exists');
select has_column('public', 'plans', 'review_status', 'plans.review_status exists');
select has_column('public', 'plans', 'approved_by', 'plans.approved_by exists');
select has_column('public', 'plans', 'approved_at', 'plans.approved_at exists');
select has_column('public', 'parent_reports', 'content', 'parent_reports.content exists');
select has_column('public', 'parent_reports', 'pdf_path', 'parent_reports.pdf_path exists');
select has_column('public', 'parent_reports', 'review_status', 'parent_reports.review_status exists');
select has_column('public', 'parent_reports', 'approved_by', 'parent_reports.approved_by exists');
select has_column('public', 'stage0_results', 'request', 'stage0_results.request exists');
select has_column('public', 'stage0_results', 'response', 'stage0_results.response exists');
select has_column('public', 'stage0_results', 'examiner_id', 'stage0_results.examiner_id exists');
select has_column('public', 'stage0_results', 'review_status', 'stage0_results.review_status exists');
select has_column('public', 'audit_log', 'actor_id', 'audit_log.actor_id exists');
select has_column('public', 'audit_log', 'action', 'audit_log.action exists');
select has_column('public', 'audit_log', 'table_name', 'audit_log.table_name exists');
select has_column('public', 'audit_log', 'row_id', 'audit_log.row_id exists');
select has_column('public', 'audit_log', 'before', 'audit_log.before exists');
select has_column('public', 'audit_log', 'after', 'audit_log.after exists');
select has_column('public', 'audit_log', 'at', 'audit_log.at exists');
select is((select count(*)::int
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in
    ('profiles','children','consents','sessions','item_results','tap_results','fingerprints','skill_mastery','plans','parent_reports','stage0_results','audit_log')
    and c.relrowsecurity), 12, 'all canonical public tables have RLS enabled');
select is((select count(*)::int
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
    and table_name in ('profiles','children','consents','sessions','item_results','tap_results','fingerprints','skill_mastery','plans','parent_reports','stage0_results','audit_log')), 0, 'anon has no canonical table grants');
select ok(not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'), 'custom access-token hook is not callable by authenticated users');
select ok(has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'), 'custom access-token hook is callable by Auth only');

-- Key range and enum constraints remain database constraints, not UI checks.
select throws_ok($$insert into public.children (first_name, grade, birth_month, dialect_lexicon_id, guardian_id, specialist_id, is_demo)
  values ('bad', 0, '2017-01', 'kw', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201', true)$$, NULL::text, NULL::text, 'grade lower bound enforced');
select throws_ok($$insert into public.children (first_name, grade, birth_month, dialect_lexicon_id, guardian_id, specialist_id, is_demo)
  values ('bad', 7, '2017-01', 'kw', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201', true)$$, NULL::text, NULL::text, 'grade upper bound enforced');
select throws_ok($$insert into public.children (first_name, grade, birth_month, dialect_lexicon_id, guardian_id, specialist_id, is_demo)
  values ('bad', 2, '2017-01', 'not-a-lexicon', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201', true)$$, NULL::text, NULL::text, 'dialect lexicon constrained');
select throws_ok($$insert into public.children (first_name, grade, birth_month, dialect_lexicon_id, guardian_id, specialist_id, is_demo)
  values ('bad', 2, '2017-13', 'kw', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201', true)$$, NULL::text, NULL::text, 'birth month constrained to yyyy-mm');
select throws_ok($$insert into public.skill_mastery (child_id, skill_id, mastery, source_session_id)
  values ('00000000-0000-0000-0000-000000001001', 'ls.alif', 1.1, '00000000-0000-0000-0000-000000003002')$$, NULL::text, NULL::text, 'mastery upper bound enforced');
select throws_ok($$insert into public.skill_mastery (child_id, skill_id, mastery, source_session_id)
  values ('00000000-0000-0000-0000-000000001001', 'ls.alif', -0.1, '00000000-0000-0000-0000-000000003002')$$, NULL::text, NULL::text, 'mastery lower bound enforced');

select * from finish();
rollback;
