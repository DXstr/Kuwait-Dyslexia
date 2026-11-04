begin;
select no_plan();

create or replace function pg_temp.set_actor(p_actor uuid, p_app_role text default 'authenticated')
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_actor::text, 'app_role', p_app_role)::text,
    true
  );
$$;
grant execute on function pg_temp.set_actor(uuid, text) to authenticated;

-- Synthetic identities and a visibly synthetic child; no working credentials.
reset role;
insert into auth.users(id, email, encrypted_password)
values
  ('00000000-0000-4000-a000-000000007001', 'b10-specialist@example.invalid', ''),
  ('00000000-0000-4000-a000-000000007002', 'b10-other-specialist@example.invalid', ''),
  ('00000000-0000-4000-a000-000000007003', 'b10-guardian@example.invalid', '')
on conflict (id) do nothing;
update public.profiles
set role = v.role, display_name = v.name
from (values
  ('00000000-0000-4000-a000-000000007001'::uuid, 'specialist'::text, 'B10 أخصائي (ملف تجريبي)'::text),
  ('00000000-0000-4000-a000-000000007002'::uuid, 'specialist'::text, 'B10 أخصائي آخر (ملف تجريبي)'::text),
  ('00000000-0000-4000-a000-000000007003'::uuid, 'guardian'::text, 'B10 ولي أمر (ملف تجريبي)'::text)
) as v(id, role, name)
where profiles.id = v.id;
insert into public.children(id, first_name, grade, birth_month, dialect_lexicon_id, guardian_id, specialist_id, is_demo)
values ('00000000-0000-4000-a000-000000007010', 'اختبار Probe (ملف تجريبي)', 2, '2018-01', 'kw',
        '00000000-0000-4000-a000-000000007003', '00000000-0000-4000-a000-000000007001', true)
on conflict (id) do nothing;
insert into public.consents(id, child_id, guardian_id, specialist_id, scope, signed_at, expires_at, evidence_path)
values ('00000000-0000-4000-a000-000000007011', '00000000-0000-4000-a000-000000007010',
        '00000000-0000-4000-a000-000000007003', '00000000-0000-4000-a000-000000007001',
        'assessment', now() - interval '1 minute', now() + interval '1 day', 'synthetic-b10-probe-consent-not-real')
on conflict (id) do nothing;

select pg_temp.set_actor('00000000-0000-4000-a000-000000007001', 'specialist');
set local role authenticated;
select lives_ok($$insert into public.sessions(id, child_id, type, run_by)
  values ('00000000-0000-4000-a000-000000007020', '00000000-0000-4000-a000-000000007010', 'probe',
          '00000000-0000-4000-a000-000000007002')$$,
  'assigned specialist can start a consented probe and server owns run_by');
select is((select run_by from public.sessions where id = '00000000-0000-4000-a000-000000007020'),
  '00000000-0000-4000-a000-000000007001'::uuid, 'probe actor cannot be forged through session metadata');

create or replace function pg_temp.probe_response(p_session uuid, p_model text default 'synthetic-b10-0.1')
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'session_id', p_session::text,
    'model_version', p_model,
    'synthetic', true,
    'per_skill', jsonb_build_array(jsonb_build_object(
      'skill_id', 'ls.baa', 'practised_accuracy', 0.75, 'unseen_accuracy', 0.5,
      'n_practised', 4, 'n_unseen', 2, 'transfer', 'no_transfer_yet'))
  );
$$;
grant execute on function pg_temp.probe_response(uuid, text) to authenticated;
reset role;

-- The database validates the unchanged canonical ProbeResponse, not merely JSON shape.
select pg_temp.set_actor('00000000-0000-4000-a000-000000007001', 'specialist');
set local role authenticated;
select throws_ok($$select * from public.finalize_probe(
  '00000000-0000-4000-a000-000000007020',
  '00000000-0000-4000-a000-000000007021',
  jsonb_build_object('session_id', '00000000-0000-4000-a000-000000007020', 'synthetic', true))$$,
  '23514', null, 'malformed ProbeResponse is rejected before persistence');
select throws_ok($$select * from public.finalize_probe(
  '00000000-0000-4000-a000-000000007020',
  '00000000-0000-4000-a000-000000007021',
  pg_temp.probe_response('00000000-0000-4000-a000-000000007099'))$$,
  '23514', null, 'response session_id mismatch is rejected');

select lives_ok($$select * from public.finalize_probe(
  '00000000-0000-4000-a000-000000007020',
  '00000000-0000-4000-a000-000000007021',
  pg_temp.probe_response('00000000-0000-4000-a000-000000007020'))$$,
  'valid ProbeResponse is durably acknowledged atomically');
select is((select count(*)::int from public.probe_results where session_id = '00000000-0000-4000-a000-000000007020'), 1,
  'one durable row exists for the probe session');
select is((select status::text from public.sessions where id = '00000000-0000-4000-a000-000000007020'), 'completed',
  'probe session completes only with an acknowledged result');
select is((select response from public.probe_results where session_id = '00000000-0000-4000-a000-000000007020'),
  pg_temp.probe_response('00000000-0000-4000-a000-000000007020'), 'canonical response JSON is stored unchanged');
select is((select child_id from public.probe_results where session_id = '00000000-0000-4000-a000-000000007020'),
  '00000000-0000-4000-a000-000000007010'::uuid, 'child_id is correlated from the server session');
select ok((select id <> '00000000-0000-4000-a000-000000007021'::uuid and created_at > now() - interval '1 minute'
  from public.probe_results where session_id = '00000000-0000-4000-a000-000000007020'),
  'row ID and created_at are database-owned');
create temp table b10_probe_snapshot as
  select id, created_at from public.probe_results where session_id = '00000000-0000-4000-a000-000000007020';
create temp table b10_probe_audit_snapshot as
  select count(*)::int as n from public.audit_log where table_name = 'probe_results'
    and row_id = (select id::text from b10_probe_snapshot);

-- Exact retry is idempotent, preserving the original row and timestamp.
select lives_ok($$select * from public.finalize_probe(
  '00000000-0000-4000-a000-000000007020',
  '00000000-0000-4000-a000-000000007021',
  pg_temp.probe_response('00000000-0000-4000-a000-000000007020'))$$,
  'exact retry returns the existing durable acknowledgement');
select is((select count(*)::int from public.probe_results where session_id = '00000000-0000-4000-a000-000000007020'), 1,
  'exact retry does not create another row or cycle');
select is((select created_at from public.probe_results where session_id = '00000000-0000-4000-a000-000000007020'),
  (select created_at from b10_probe_snapshot), 'exact retry preserves the original server timestamp');
select is((select n from b10_probe_audit_snapshot),
  (select count(*)::int from public.audit_log where table_name = 'probe_results'
    and row_id = (select id::text from b10_probe_snapshot)), 'exact retry does not add audit evidence');

select throws_ok($$select * from public.finalize_probe(
  '00000000-0000-4000-a000-000000007020',
  '00000000-0000-4000-a000-000000007022',
  pg_temp.probe_response('00000000-0000-4000-a000-000000007020'))$$,
  '23505', null, 'a new event UUID cannot create a second result for one session');
select throws_ok($$select * from public.finalize_probe(
  '00000000-0000-4000-a000-000000007020',
  '00000000-0000-4000-a000-000000007021',
  pg_temp.probe_response('00000000-0000-4000-a000-000000007020', 'tampered'))$$,
  '23505', null, 'changed response on retry is rejected as a conflict');

-- No direct authenticated write path exists, and completion cannot bypass evidence.
select throws_ok($$insert into public.probe_results(session_id, child_id, event_id, response, synthetic)
  values ('00000000-0000-4000-a000-000000007020', '00000000-0000-4000-a000-000000007010',
          '00000000-0000-4000-a000-000000007023', pg_temp.probe_response('00000000-0000-4000-a000-000000007020'), true)$$,
  '42501', null, 'authenticated clients cannot insert probe results directly');
select throws_ok($$update public.probe_results set synthetic = false
  where session_id = '00000000-0000-4000-a000-000000007020'$$,
  '42501', null, 'probe evidence is immutable');
select throws_ok($$delete from public.probe_results where session_id = '00000000-0000-4000-a000-000000007020'$$,
  '42501', null, 'probe evidence cannot be deleted');
select lives_ok($$insert into public.sessions(id, child_id, type, run_by)
  values ('00000000-0000-4000-a000-000000007024', '00000000-0000-4000-a000-000000007010', 'probe',
          '00000000-0000-4000-a000-000000007001')$$, 'second probe starts for bypass-completion test');
select throws_ok($$update public.sessions set status = 'completed'
  where id = '00000000-0000-4000-a000-000000007024'$$,
  '23514', null, 'probe cannot be completed without a durable result');

-- Guardians and unassigned specialists cannot read raw probe rows or finalize them.
select pg_temp.set_actor('00000000-0000-4000-a000-000000007003', 'guardian');
select is((select count(*)::int from public.probe_results), 0, 'guardian has no raw probe-result access');
select throws_ok($$select * from public.finalize_probe(
  '00000000-0000-4000-a000-000000007020',
  '00000000-0000-4000-a000-000000007021',
  pg_temp.probe_response('00000000-0000-4000-a000-000000007020'))$$,
  '42501', null, 'guardian cannot finalize a probe');
select pg_temp.set_actor('00000000-0000-4000-a000-000000007002', 'specialist');
select is((select count(*)::int from public.probe_results), 0, 'unassigned specialist has no raw probe-result access');
select pg_temp.set_actor('00000000-0000-4000-a000-000000007001', 'specialist');
select is((select count(*)::int from public.probe_results), 1, 'assigned specialist can read the durable result');
select pg_temp.set_actor('00000000-0000-4000-a000-000000000001', 'admin');
select is((select count(*)::int from public.probe_results), 1, 'admin can read the durable result');

select is((select count(*)::int from public.audit_log where table_name = 'probe_results'
  and row_id = (select id::text from b10_probe_snapshot) and actor_id = '00000000-0000-4000-a000-000000007001'::uuid), 1,
  'successful durable write has one append-only attributed audit entry');

select * from finish();
rollback;
