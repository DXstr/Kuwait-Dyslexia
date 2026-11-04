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

create or replace function pg_temp.score_response(p_item text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'item_id', p_item,
    'item_type', 'real_word',
    'model_version', 'storage-fixture-1',
    'synthetic', true,
    'audio_duration_ms', 420,
    'words', jsonb_build_array(jsonb_build_object('index', 0, 'text', 'باب', 'correct', true)),
    'phonemes', '[]'::jsonb,
    'skill_evidence', jsonb_build_array(jsonb_build_object(
      'skill_id', 'ls.alif', 'correct', true, 'source', 'audio'
    )),
    'wcpm', null,
    'warnings', '[]'::jsonb
  );
$$;

create or replace function pg_temp.parent_report_content()
returns jsonb
language sql
immutable
as $$
  select '{
    "language":"ar",
    "child_first_name":"سارة (ملف تجريبي)",
    "session_date":"2026-11-01",
    "duration_min":12,
    "practised":[{"skill_id":"dot.baa-taa-thaa-nuun-yaa","plain_ar":"الحروف المتشابهة بالنقاط: ب ت ث"}],
    "progress_notes":[{"skill_id":"dot.baa-taa-thaa-nuun-yaa","note_ar":"تزداد ثقتها في التمييز بين ب و ت."}],
    "home_plan":[{"title_ar":"لعبة النقاط","minutes":5,"words":["ثَوْب","تَوْب","بَاب"],"how_ar":"اقرآ الكلمات معًا، وشجّعيها بلطف عند كل محاولة."}],
    "next_focus_ar":"سنكمل التمييز بين الحروف المتشابهة بالنقاط.",
    "specialist":{"name":"الأخصائية (ملف تجريبي)","contact":"storage-test@example.invalid"}
  }'::jsonb;
$$;

reset role;
insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'guardian-storage@test.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'specialist-storage@test.invalid'),
  ('33333333-3333-4333-8333-333333333333', 'examiner-storage@test.invalid')
on conflict (id) do nothing;

update public.profiles
set role = v.role, display_name = v.display_name
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'guardian', 'Guardian storage fixture'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'specialist', 'Specialist storage fixture'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'examiner', 'Examiner storage fixture')
) as v(id, role, display_name)
where profiles.id = v.id;

insert into public.children
  (id, first_name, grade, birth_month, dialect_lexicon_id, guardian_id, specialist_id, is_demo)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Storage child (ملف تجريبي)', 2, '2018-01', 'kw',
   '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', true)
on conflict (id) do nothing;

-- These rows model historical fixtures. Application inserts are server-timestamped
-- by guard_consent; this privileged fixture keeps the explicit historical dates.
alter table public.consents disable trigger guard_consent;
insert into public.consents
  (id, child_id, guardian_id, specialist_id, scope, signed_at, expires_at, evidence_path, ethics_ref)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
   'assessment', '2025-12-01T00:00:00Z', '2027-12-31T00:00:00Z', 'fixture/storage-assessment', null),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
   'audio_research', '2025-12-01T00:00:00Z', '2027-12-31T00:00:00Z', 'fixture/storage-audio-research', 'storage-test')
on conflict (id) do update
set expires_at = excluded.expires_at,
    evidence_path = excluded.evidence_path,
    ethics_ref = excluded.ethics_ref;
alter table public.consents enable trigger guard_consent;

-- The first historical row is a specialist-run assessment; the second is an
-- examiner-run Stage 0 row. Historical start
-- timestamps are then installed only through a privileged, narrowly scoped
-- trigger disable; lifecycle fields remain guard-controlled.
select pg_temp.set_actor('22222222-2222-4222-8222-222222222222');
set local role authenticated;
insert into public.sessions (id, child_id, type, status, started_at, ended_at, run_by)
values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'assessment', 'in_progress', now(), null, '22222222-2222-4222-8222-222222222222');
select pg_temp.set_actor('33333333-3333-4333-8333-333333333333');
insert into public.sessions (id, child_id, type, status, started_at, ended_at, run_by)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'stage0', 'in_progress', now(), null, '33333333-3333-4333-8333-333333333333');
reset role;
alter table public.sessions disable trigger guard_session;
update public.sessions
set started_at = '2026-01-01T00:00:00Z'
where id in (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
);
alter table public.sessions enable trigger guard_session;

select pg_temp.set_actor('22222222-2222-4222-8222-222222222222');
set local role authenticated;
insert into public.item_results
  (id, session_id, item_id, response, audio_path, audio_expires_at, synthetic)
values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'item-expired', pg_temp.score_response('item-expired'),
   'audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/item-expired.wav',
   '2026-01-31T00:00:00Z', true),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'item-research', pg_temp.score_response('item-research'),
   'audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/item-research.wav',
   '2026-01-31T00:00:00Z', true),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccce', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
   'item-examiner', pg_temp.score_response('item-examiner'),
   'audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/item-examiner.wav',
   '2026-01-31T00:00:00Z', true);

insert into public.parent_reports
  (id, child_id, session_id, content, pdf_path)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pg_temp.parent_report_content(),
   'reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddde', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pg_temp.parent_report_content(),
   'reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dddddddd-dddd-4ddd-8ddd-ddddddddddde.pdf'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddf', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pg_temp.parent_report_content(),
   'reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dddddddd-dddd-4ddd-8ddd-dddddddddddf.pdf');
update public.parent_reports
set review_status = 'pending_review'
where id in (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddf'
);
update public.parent_reports
set review_status = 'approved'
where id in (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddf'
);
/* The middle report remains draft for the positive insert/update policy case. */
reset role;

-- These direct rows are metadata-only test fixtures; no audio bytes are uploaded.
insert into storage.objects (bucket_id, name, owner, metadata)
values
  ('audio', 'audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/item-expired.wav', '22222222-2222-4222-8222-222222222222', '{}'),
  ('audio', 'audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/item-research.wav', '22222222-2222-4222-8222-222222222222', '{}'),
  ('audio', 'audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/item-examiner.wav', '33333333-3333-4333-8333-333333333333', '{}'),
  ('reports', 'reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf', '22222222-2222-4222-8222-222222222222', '{}')
on conflict do nothing;

select is((select b.name from storage.buckets b where b.id = 'audio'), 'audio', 'audio bucket exists');
select is((select b.public from storage.buckets b where b.id = 'audio'), false, 'audio bucket is private');
select is((select b.name from storage.buckets b where b.id = 'reports'), 'reports', 'reports bucket exists');
select is((select b.public from storage.buckets b where b.id = 'reports'), false, 'reports bucket is private');
select is((select b.file_size_limit from storage.buckets b where b.id = 'audio'), 10485760::bigint, 'audio has a finite size cap');
select is((select b.allowed_mime_types from storage.buckets b where b.id = 'audio'), array['audio/wav']::text[], 'audio accepts WAV only');

-- Draft report bytes can be uploaded, but become immutable at pending_review.
select pg_temp.set_actor('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select lives_ok($$insert into storage.objects (bucket_id, name, owner, metadata)
  values ('reports', 'reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dddddddd-dddd-4ddd-8ddd-ddddddddddde.pdf', '22222222-2222-4222-8222-222222222222', '{}')$$,
  'specialist can insert a draft report PDF');
select lives_ok($$update storage.objects set metadata = '{"draft":true}'::jsonb
  where bucket_id = 'reports' and name = 'reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dddddddd-dddd-4ddd-8ddd-ddddddddddde.pdf'$$,
  'specialist can update draft report bytes');
select is((select metadata from storage.objects where name like '%dddddddd-dddd-4ddd-8ddd-ddddddddddde.pdf'), '{"draft":true}'::jsonb, 'draft report update is stored');
update public.parent_reports set review_status = 'pending_review'
where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddde';
select lives_ok($$update storage.objects set metadata = '{"tampered":true}'::jsonb
  where bucket_id = 'reports' and name = 'reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dddddddd-dddd-4ddd-8ddd-ddddddddddde.pdf'$$,
  'pending report overwrite is rejected by RLS without an SQL error');
select is((select metadata from storage.objects where name like '%dddddddd-dddd-4ddd-8ddd-ddddddddddde.pdf'), '{"draft":true}'::jsonb, 'pending report bytes remain unchanged');
select throws_ok($$insert into storage.objects (bucket_id, name, owner, metadata)
  values ('reports', 'reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dddddddd-dddd-4ddd-8ddd-dddddddddddf.pdf', '22222222-2222-4222-8222-222222222222', '{}')$$, NULL::text, NULL::text, 'approved report PDF insert is denied by the draft-only policy');

-- Approved PDFs and all audio are immutable to authenticated SQL/storage callers.
select lives_ok($$update storage.objects set metadata = '{"tampered":true}'::jsonb
  where bucket_id = 'reports' and name = 'reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf'$$,
  'approved report overwrite is rejected by RLS without an SQL error');
select is((select metadata from storage.objects where name like '%dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf'), '{}'::jsonb, 'approved PDF bytes remain unchanged');
select lives_ok($$update storage.objects set metadata = '{"tampered":true}'::jsonb
  where bucket_id = 'audio' and name like '%item-research.wav'$$,
  'audio overwrite is rejected because no update policy exists');
select is((select metadata from storage.objects where name like '%item-research.wav'), '{}'::jsonb, 'audio bytes remain unchanged');
reset role;

-- Guardians never see audio; an examiner sees only their own assigned stage0
-- session while current profile role and consent are valid.
select pg_temp.set_actor('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'audio'), 0::bigint, 'guardian cannot read audio objects');
select is((select count(*) from storage.objects where bucket_id = 'reports'), 1::bigint, 'guardian sees the exact approved report path only');
select pg_temp.set_actor('33333333-3333-4333-8333-333333333333', 'examiner');
select is((select count(*) from storage.objects where bucket_id = 'audio'), 1::bigint, 'examiner reads own assigned stage0 audio with current consent');
reset role;

-- Complete the assigned examiner session through the guarded state transition
-- before changing its profile role; active assignments must block demotion.
reset role;
select pg_temp.set_actor('22222222-2222-4222-8222-222222222222', 'specialist');
update public.sessions
set status = 'completed'
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

-- A stale examiner JWT app_role cannot override the current profile role.
update public.profiles set role = 'guardian'
where id = '33333333-3333-4333-8333-333333333333';
select pg_temp.set_actor('33333333-3333-4333-8333-333333333333', 'examiner');
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'audio'), 0::bigint, 'stale examiner app_role is denied by current profile role');
reset role;
update public.profiles set role = 'examiner'
where id = '33333333-3333-4333-8333-333333333333';

-- Shortening research consent immediately removes its retention extension.
select is(
  basira_private.audio_retention_deadline('cccccccc-cccc-4ccc-8ccc-cccccccccccd', '2026-01-15T00:00:00Z'),
  '2027-12-31T00:00:00Z'::timestamptz,
  'valid research consent extends the default deadline'
);
-- This is a historical fixture timestamp. Application revocation is intentionally
-- server-clocked by guard_consent; preserve the explicit historical date only in
-- this privileged fixture setup.
reset role;
alter table public.consents disable trigger guard_consent;
update public.consents
set expires_at = '2026-01-20T00:00:00Z'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02';
alter table public.consents enable trigger guard_consent;
select is(
  basira_private.audio_retention_deadline('cccccccc-cccc-4ccc-8ccc-cccccccccccd', '2026-02-01T00:00:00Z'),
  '2026-01-31T00:00:00Z'::timestamptz,
  'shortened or expired research consent removes the extension'
);

select set_config('request.jwt.claims', '{}'::text, true);
select is((select count(*) from public.expired_audio_paths(100)), 3::bigint, 'service discovery returns all currently expired audio');
select is((select response from public.item_results where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccd'), pg_temp.score_response('item-research'), 'scorer response remains unchanged before cleanup');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*) from public.confirm_audio_deleted(jsonb_build_array(jsonb_build_object(
  'item_result_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'object_path', 'audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/item-expired.wav'
)))), 0::bigint, 'confirmation refuses while the matching Storage metadata remains');
select is((select count(*) from public.confirm_audio_deleted(jsonb_build_array(jsonb_build_object(
  'item_result_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'object_path', 'audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/item-research.wav'
)))), 0::bigint, 'confirmation refuses a mismatched item/path pair');
reset role;
-- Simulate the completed Storage API delete by removing only this metadata-only
-- fixture as postgres; no actual audio file was ever uploaded by this test.
set local storage.allow_delete_query = 'true';
delete from storage.objects
where bucket_id = 'audio'
  and name = 'audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/item-expired.wav';
set local storage.allow_delete_query = 'false';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*) from public.confirm_audio_deleted(jsonb_build_array(jsonb_build_object(
  'item_result_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'object_path', 'audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/item-expired.wav'
)))), 1::bigint, 'service_role confirmation clears a due path only after Storage metadata is absent');
reset role;
select is((select audio_path from public.item_results where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), null, 'confirmed cleanup clears only audio_path');
select is((select response from public.item_results where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), pg_temp.score_response('item-expired'), 'cleanup leaves response JSON unchanged');

select pg_temp.set_actor('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select throws_ok(
  $$select * from public.expired_audio_paths(100)$$,
  '42501',
  NULL::text,
  'authenticated cannot discover expired audio'
);
reset role;

select ok(has_function_privilege('service_role', 'public.confirm_audio_deleted(jsonb)', 'EXECUTE'), 'service_role can execute the JSONB confirmation signature');
select ok(not has_function_privilege('authenticated', 'public.confirm_audio_deleted(jsonb)', 'EXECUTE'), 'authenticated cannot execute the JSONB confirmation signature');
select throws_ok(
  $$select * from public.confirm_audio_deleted(jsonb_build_array(jsonb_build_object('item_result_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'object_path', 'audio/missing')))$$,
  '42501',
  NULL::text,
  'authenticated cannot confirm audio deletion'
);

select is((select count(*) from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and cmd = 'DELETE'), 0::bigint,
  'storage.objects has no SQL delete policy for clients');

select * from finish();
rollback;
