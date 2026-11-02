begin;

select no_plan();

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

reset role;
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000101', 'guardian1@example.invalid', '{"role":"admin"}'::jsonb),
  ('00000000-0000-0000-0000-000000000102', 'guardian2@example.invalid', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000201', 'specialist1@example.invalid', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000202', 'specialist2@example.invalid', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000301', 'examiner1@example.invalid', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000401', 'admin1@example.invalid', '{}'::jsonb)
on conflict (id) do nothing;

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

select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
set local role authenticated;
insert into public.sessions (id, child_id, type, run_by)
values
  ('00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000001001', 'assessment', '00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000001001', 'practice', '00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000003003', '00000000-0000-0000-0000-000000001001', 'stage0', '00000000-0000-0000-0000-000000000301'),
  ('00000000-0000-0000-0000-000000003004', '00000000-0000-0000-0000-000000001001', 'assessment', '00000000-0000-0000-0000-000000000201');

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
create or replace function pg_temp.parent_report_content()
returns jsonb language sql immutable as $$
  select '{
    "language":"ar", "child_first_name":"ليان", "session_date":"2026-11-02", "duration_min":10,
    "practised":[{"skill_id":"ls.alif","plain_ar":"تمييز الحرف"}],
    "progress_notes":[{"skill_id":"ls.alif","note_ar":"تدريب مستمر"}],
    "home_plan":[{"title_ar":"قراءة قصيرة","minutes":5,"words":["أب"],"how_ar":"اقرأ بهدوء"}],
    "next_focus_ar":"القراءة اليومية", "specialist":{"name":"أخصائي ١","contact":"fixture"}
  }'::jsonb;
$$;
create or replace function pg_temp.stage0_request()
returns jsonb language sql immutable as $$
  select '{"construct":"phonological_awareness","instrument_id":"fixture-instrument","child_age_months":96,"grade":2,"responses":[{"item_id":"q1","response":true}]}'::jsonb;
$$;
create or replace function pg_temp.stage0_response()
returns jsonb language sql immutable as $$
  select '{"construct":"phonological_awareness","instrument_id":"fixture-instrument","licence_status":"public_domain","raw_score":1,"scaled_score":null,"norm_source":null,"note_en":"fixture","scorer_version":"fixture-1","synthetic":true}'::jsonb;
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
values ('00000000-0000-0000-0000-000000004003', '00000000-0000-0000-0000-000000003001', pg_temp.fingerprint_response('00000000-0000-0000-0000-000000003001'));
insert into public.fingerprints (id, session_id, response)
values ('00000000-0000-0000-0000-000000004004', '00000000-0000-0000-0000-000000003004', pg_temp.fingerprint_response('00000000-0000-0000-0000-000000003004'));
insert into public.plans (id, child_id, skill_ids, item_ids)
values
  ('00000000-0000-0000-0000-000000005001', '00000000-0000-0000-0000-000000001001', array['ls.alif'], array['fixture-item']),
  ('00000000-0000-0000-0000-000000005002', '00000000-0000-0000-0000-000000001001', array['ls.alif'], array['fixture-item']),
  ('00000000-0000-0000-0000-000000005003', '00000000-0000-0000-0000-000000001001', array['ls.alif'], array['fixture-item']),
  ('00000000-0000-0000-0000-000000005004', '00000000-0000-0000-0000-000000001001', array['ls.alif'], array['fixture-item']);
insert into public.parent_reports (id, child_id, session_id, content, pdf_path)
values
  ('00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000003002', pg_temp.parent_report_content(), 'reports/00000000-0000-0000-0000-000000001001/00000000-0000-0000-0000-000000006001.pdf'),
  ('00000000-0000-0000-0000-000000006002', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000003002', pg_temp.parent_report_content(), 'reports/00000000-0000-0000-0000-000000001001/00000000-0000-0000-0000-000000006002.pdf'),
  ('00000000-0000-0000-0000-000000006004', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000003002', pg_temp.parent_report_content(), 'reports/00000000-0000-0000-0000-000000001001/00000000-0000-0000-0000-000000006004.pdf');
insert into public.stage0_results (id, child_id, session_id, request, response, examiner_id)
values
  ('00000000-0000-0000-0000-000000007001', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000003003', pg_temp.stage0_request(), pg_temp.stage0_response(), '00000000-0000-0000-0000-000000000301'),
  ('00000000-0000-0000-0000-000000007002', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000003003', pg_temp.stage0_request(), pg_temp.stage0_response(), '00000000-0000-0000-0000-000000000301');

reset role;
-- Review defaults are database-owned, not supplied by the client.
select is((select review_status::text from public.fingerprints where id = '00000000-0000-0000-0000-000000004003'), 'pending_review', 'fingerprint defaults to pending_review');
select is((select reviewed_by from public.fingerprints where id = '00000000-0000-0000-0000-000000004003'), null, 'fingerprint reviewed_by starts null');
select is((select reviewed_at from public.fingerprints where id = '00000000-0000-0000-0000-000000004003'), null, 'fingerprint reviewed_at starts null');
select is((select review_status::text from public.plans where id = '00000000-0000-0000-0000-000000005001'), 'draft', 'plan defaults to draft');
select is((select review_status::text from public.parent_reports where id = '00000000-0000-0000-0000-000000006001'), 'draft', 'parent report defaults to draft');
select is((select review_status::text from public.stage0_results where id = '00000000-0000-0000-0000-000000007001'), 'draft', 'stage0 defaults to draft');
select is((select count(*)::int from information_schema.columns
  where table_schema = 'public' and table_name = 'stage0_results'
    and column_name in ('approved_by','approved_at','reviewed_by','reviewed_at')), 0,
  'stage0 has no approval actor columns');

-- Clients may not insert any reviewable object already marked approved.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
set local role authenticated;
select throws_ok($$insert into public.fingerprints (id, session_id, response, review_status)
  values ('00000000-0000-0000-0000-000000004005', '00000000-0000-0000-0000-000000003004', pg_temp.fingerprint_response('00000000-0000-0000-0000-000000003004'), 'approved')$$, NULL::text, NULL::text, 'fingerprint approved insert is denied');
select throws_ok($$insert into public.plans (id, child_id, skill_ids, item_ids, review_status)
  values ('00000000-0000-0000-0000-000000005005', '00000000-0000-0000-0000-000000001001', array['ls.alif'], array['fixture-item'], 'approved')$$, NULL::text, NULL::text, 'plan approved insert is denied');
select throws_ok($$insert into public.parent_reports (id, child_id, session_id, content, review_status)
  values ('00000000-0000-0000-0000-000000006003', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000003002', pg_temp.parent_report_content(), 'approved')$$, NULL::text, NULL::text, 'parent report approved insert is denied');
select throws_ok($$insert into public.stage0_results (id, child_id, session_id, request, response, examiner_id, review_status)
  values ('00000000-0000-0000-0000-000000007003', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000003003', pg_temp.stage0_request(), pg_temp.stage0_response(), '00000000-0000-0000-0000-000000000301', 'approved')$$, NULL::text, NULL::text, 'stage0 approved insert is denied');

-- Legal transitions: draft -> pending_review -> approved -> delivered.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
select lives_ok($$update public.plans set review_status = 'pending_review' where id = '00000000-0000-0000-0000-000000005001'$$, 'plan draft can enter pending_review');
select lives_ok($$update public.plans set review_status = 'approved' where id = '00000000-0000-0000-0000-000000005001'$$, 'assigned specialist can approve plan');
select lives_ok($$update public.plans set review_status = 'delivered' where id = '00000000-0000-0000-0000-000000005001'$$, 'approved plan can be delivered');
select lives_ok($$update public.parent_reports set review_status = 'pending_review' where id = '00000000-0000-0000-0000-000000006001'$$, 'parent report draft can enter pending_review');
select lives_ok($$update public.parent_reports set review_status = 'approved' where id = '00000000-0000-0000-0000-000000006001'$$, 'assigned specialist can approve parent report');
select lives_ok($$update public.parent_reports set review_status = 'delivered' where id = '00000000-0000-0000-0000-000000006001'$$, 'approved parent report can be delivered');
select lives_ok($$update public.stage0_results set review_status = 'pending_review' where id = '00000000-0000-0000-0000-000000007001'$$, 'stage0 draft can enter pending_review');
select lives_ok($$update public.stage0_results set review_status = 'approved' where id = '00000000-0000-0000-0000-000000007001'$$, 'assigned specialist can approve stage0');
select lives_ok($$update public.stage0_results set review_status = 'delivered' where id = '00000000-0000-0000-0000-000000007001'$$, 'approved stage0 can be delivered');
select lives_ok($$update public.fingerprints set review_status = 'approved' where id = '00000000-0000-0000-0000-000000004003'$$, 'assigned specialist can approve fingerprint');
select is((select pdf_path from public.parent_reports where id = '00000000-0000-0000-0000-000000006001'), 'reports/00000000-0000-0000-0000-000000001001/00000000-0000-0000-0000-000000006001.pdf', 'parent report PDF path is canonical child/report path');

-- Parent-report attribution is server-owned on the pending_review -> approved
-- transition, even when the client supplies a forged reviewer.
select lives_ok($$update public.parent_reports
  set review_status = 'pending_review', approved_by = '00000000-0000-0000-0000-000000000101'
  where id = '00000000-0000-0000-0000-000000006004'$$, 'parent report draft can enter pending_review with spoof fields');
select lives_ok($$update public.parent_reports
  set review_status = 'approved', approved_by = '00000000-0000-0000-0000-000000000101'
  where id = '00000000-0000-0000-0000-000000006004'$$, 'parent report approval ignores approval spoof fields');
select is((select approved_by from public.parent_reports where id = '00000000-0000-0000-0000-000000006004'), '00000000-0000-0000-0000-000000000201'::uuid, 'parent report approver is server-derived');
select lives_ok($$update public.parent_reports set review_status = 'delivered' where id = '00000000-0000-0000-0000-000000006004'$$, 'approved parent report can be delivered after spoof test');

-- The trigger derives reviewer/time from the authenticated profile, rather
-- than accepting client-provided approval metadata.
select is((select reviewed_by from public.fingerprints where id = '00000000-0000-0000-0000-000000004003'), '00000000-0000-0000-0000-000000000201'::uuid, 'fingerprint reviewer is server-derived');
select ok((select reviewed_at > now() - interval '1 minute' from public.fingerprints where id = '00000000-0000-0000-0000-000000004003'), 'fingerprint review time is server-derived');
select is((select approved_by from public.plans where id = '00000000-0000-0000-0000-000000005001'), '00000000-0000-0000-0000-000000000201'::uuid, 'plan approver is server-derived');
select ok((select approved_at > now() - interval '1 minute' from public.plans where id = '00000000-0000-0000-0000-000000005001'), 'plan approval time is server-derived');
reset role;
select is((select actor_id from public.audit_log where table_name = 'stage0_results' and row_id = '00000000-0000-0000-0000-000000007001' order by at desc limit 1), '00000000-0000-0000-0000-000000000201'::uuid, 'stage0 audit attributes approval actor');
select ok((select at > now() - interval '1 minute' from public.audit_log where table_name = 'stage0_results' and row_id = '00000000-0000-0000-0000-000000007001' order by at desc limit 1), 'stage0 audit attributes server time');
set local role authenticated;

-- A client cannot spoof approval metadata, even while making a legal change.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
select lives_ok($$update public.fingerprints
  set review_status = 'approved', reviewed_by = '00000000-0000-0000-0000-000000000101', reviewed_at = '2000-01-01'
  where id = '00000000-0000-0000-0000-000000004004'$$, 'approval with spoofed metadata is normalized by trigger');
select is((select reviewed_by from public.fingerprints where id = '00000000-0000-0000-0000-000000004004'), '00000000-0000-0000-0000-000000000201'::uuid, 'spoofed fingerprint reviewer is discarded');
select ok((select reviewed_at > timestamp '2025-01-01' from public.fingerprints where id = '00000000-0000-0000-0000-000000004004'), 'spoofed fingerprint time is discarded');
select lives_ok($$update public.plans
  set review_status = 'pending_review', approved_by = '00000000-0000-0000-0000-000000000101', approved_at = '2000-01-01'
  where id = '00000000-0000-0000-0000-000000005002'$$, 'plan pending transition ignores approval spoof fields');
select lives_ok($$update public.plans
  set review_status = 'approved', approved_by = '00000000-0000-0000-0000-000000000101', approved_at = '2000-01-01'
  where id = '00000000-0000-0000-0000-000000005002'$$, 'plan approval ignores approval spoof fields');
select is((select approved_by from public.plans where id = '00000000-0000-0000-0000-000000005002'), '00000000-0000-0000-0000-000000000201'::uuid, 'spoofed plan approver is discarded');
select ok((select approved_at > timestamp '2025-01-01' from public.plans where id = '00000000-0000-0000-0000-000000005002'), 'spoofed plan time is discarded');
select throws_ok($$update public.stage0_results
  set review_status = 'delivered', examiner_id = '00000000-0000-0000-0000-000000000101'
  where id = '00000000-0000-0000-0000-000000007001'$$, NULL::text, NULL::text, 'stage0 examiner attribution cannot be spoofed');

-- Only the assigned specialist or admin can approve/reject.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000301');
with attempted as (update public.fingerprints set review_status = 'rejected' where id = '00000000-0000-0000-0000-000000004004' returning id) select is(count(*)::int, 0, 'examiner cannot approve or reject') from attempted;
select pg_temp.set_actor('00000000-0000-0000-0000-000000000202');
with attempted as (update public.plans set review_status = 'rejected' where id = '00000000-0000-0000-0000-000000005003' returning id) select is(count(*)::int, 0, 'wrong-child specialist cannot approve or reject') from attempted;
select pg_temp.set_actor('00000000-0000-0000-0000-000000000101');
with attempted as (update public.plans set review_status = 'pending_review' where id = '00000000-0000-0000-0000-000000005003' returning id) select is(count(*)::int, 0, 'guardian cannot alter review state') from attempted;
select pg_temp.set_actor('00000000-0000-0000-0000-000000000401');
select lives_ok($$update public.plans set review_status = 'pending_review' where id = '00000000-0000-0000-0000-000000005003'$$, 'admin may submit a plan for review');
select lives_ok($$update public.plans set review_status = 'approved' where id = '00000000-0000-0000-0000-000000005003'$$, 'admin may approve a plan');

-- Skipped, terminal, and reversed transitions are rejected.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
set local role authenticated;
select lives_ok($$update public.plans set review_status = 'pending_review' where id = '00000000-0000-0000-0000-000000005004'$$, 'third plan enters pending_review for illegal-transition checks');
select throws_ok($$update public.plans set review_status = 'delivered' where id = '00000000-0000-0000-0000-000000005004'$$, NULL::text, NULL::text, 'pending plan cannot skip approved');
select throws_ok($$update public.plans set review_status = 'draft' where id = '00000000-0000-0000-0000-000000005004'$$, NULL::text, NULL::text, 'pending plan cannot reverse to draft');
select throws_ok($$update public.plans set review_status = 'rejected' where id = '00000000-0000-0000-0000-000000005002'$$, NULL::text, NULL::text, 'approved plan cannot reverse to rejected');
select throws_ok($$update public.plans set review_status = 'pending_review' where id = '00000000-0000-0000-0000-000000005001'$$, NULL::text, NULL::text, 'delivered plan cannot reopen');
select throws_ok($$update public.plans set review_status = 'rejected' where id = '00000000-0000-0000-0000-000000005001'$$, NULL::text, NULL::text, 'delivered plan cannot reverse');
select throws_ok($$update public.plans set review_status = 'draft' where id = '00000000-0000-0000-0000-000000005001'$$, NULL::text, NULL::text, 'terminal plan cannot return to draft');

-- Rejection is legal only from pending_review and is terminal.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
select lives_ok($$update public.parent_reports set review_status = 'pending_review' where id = '00000000-0000-0000-0000-000000006002'$$, 'second report enters pending_review');
select lives_ok($$update public.parent_reports set review_status = 'rejected' where id = '00000000-0000-0000-0000-000000006002'$$, 'pending report can be rejected');
select throws_ok($$update public.parent_reports set review_status = 'approved' where id = '00000000-0000-0000-0000-000000006002'$$, NULL::text, NULL::text, 'rejected report cannot be approved');
select throws_ok($$update public.parent_reports set review_status = 'pending_review' where id = '00000000-0000-0000-0000-000000006002'$$, NULL::text, NULL::text, 'rejected report cannot be reopened');

-- Approval payloads and raw scorer results are immutable after review, even if
-- the client repeats the same status value.
select throws_ok($$update public.plans set review_status = 'delivered', skill_ids = array['ls.alif','vowel.fatha'] where id = '00000000-0000-0000-0000-000000005001'$$, NULL::text, NULL::text, 'approved/delivered plan payload is immutable');
select throws_ok($$update public.parent_reports set review_status = 'delivered', content = jsonb_build_object('tampered', true) where id = '00000000-0000-0000-0000-000000006001'$$, NULL::text, NULL::text, 'approved/delivered report payload is immutable');
select throws_ok($$update public.stage0_results set review_status = 'delivered', response = jsonb_build_object('tampered', true) where id = '00000000-0000-0000-0000-000000007001'$$, NULL::text, NULL::text, 'approved/delivered stage0 payload is immutable');
select throws_ok($$update public.fingerprints set review_status = 'approved', response = jsonb_build_object('tampered', true) where id = '00000000-0000-0000-0000-000000004003'$$, NULL::text, NULL::text, 'approved fingerprint payload is immutable');
select throws_ok($$update public.item_results set response = jsonb_build_object('tampered', true) where id = '00000000-0000-0000-0000-000000004001'$$, NULL::text, NULL::text, 'raw response cannot change after review');
select is((select response from public.item_results where id = '00000000-0000-0000-0000-000000004001'), pg_temp.score_response('fixture-item'), 'raw response JSON remains unchanged');

-- Guardians receive only approved/delivered parent-facing output for own
-- children, never raw scores, audio evidence, stage0 responses, or mastery.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000101');
select is((select count(*)::int from public.parent_reports), 2, 'guardian may read own approved parent reports');
select is((select count(*)::int from public.plans), 3, 'guardian may read own approved/delivered plans');
select is((select count(*)::int from public.fingerprints), 0, 'guardian cannot read fingerprints');
select is((select count(*)::int from public.stage0_results), 0, 'guardian cannot read stage0 results');
select is((select count(*)::int from public.item_results), 0, 'guardian cannot read item results');
select is((select count(*)::int from public.tap_results), 0, 'guardian cannot read tap results');
select is((select count(*)::int from public.skill_mastery), 0, 'guardian cannot read skill mastery');
select is((select count(*)::int from public.parent_reports where review_status not in ('approved','delivered')), 0, 'guardian cannot read draft/rejected reports');

-- Append-only tables have no mutation path for an authenticated client.
select pg_temp.set_actor('00000000-0000-0000-0000-000000000201');
select throws_ok($$update public.skill_mastery set mastery = 0.9 where child_id = '00000000-0000-0000-0000-000000001001'$$, NULL::text, NULL::text, 'skill mastery is append-only');
select throws_ok($$delete from public.skill_mastery where child_id = '00000000-0000-0000-0000-000000001001'$$, NULL::text, NULL::text, 'skill mastery cannot be deleted');
select throws_ok($$update public.audit_log set action = 'tampered' where table_name = 'plans'$$, NULL::text, NULL::text, 'audit log cannot be updated');
select throws_ok($$delete from public.audit_log where table_name = 'plans'$$, NULL::text, NULL::text, 'audit log cannot be deleted');
select throws_ok($$insert into public.audit_log (actor_id, action, table_name, row_id, before, after)
  values ('00000000-0000-0000-0000-000000000201', 'manual', 'plans', '00000000-0000-0000-0000-000000005001', '{}'::jsonb, '{}'::jsonb)$$, NULL::text, NULL::text, 'audit log cannot be manually inserted');
select throws_ok($$truncate public.audit_log$$, NULL::text, NULL::text, 'audit log cannot be truncated');

-- Review status and key approval columns remain contract-constrained.
reset role;
select throws_ok($$insert into public.plans (child_id, skill_ids, item_ids, review_status)
  values ('00000000-0000-0000-0000-000000001001', array['ls.alif'], array['fixture-item'], 'not-a-status')$$, NULL::text, NULL::text, 'review status enum is constrained');
select throws_ok($$insert into public.parent_reports (child_id, session_id, content, review_status)
  values ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000003002', pg_temp.parent_report_content(), 'not-a-status')$$, NULL::text, NULL::text, 'parent report review status is constrained');

select * from finish();
rollback;
