begin;
select no_plan();

-- Only the labelled, non-login-capable local demo seed is used here.
create function pg_temp.actor(id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','app_role','admin')::text,true)
$$;
grant execute on function pg_temp.actor(uuid) to authenticated;
create function pg_temp.report() returns jsonb language sql as $$
  select '{"language":"ar","child_first_name":"ليان (ملف تجريبي)","session_date":"2026-11-02","duration_min":10,"practised":[{"skill_id":"ls.alif","plain_ar":"تدريب تجريبي"}],"progress_notes":[],"home_plan":[{"title_ar":"نشاط تجريبي","minutes":5,"words":["بَاب"],"how_ar":"مثال تجريبي فقط"}],"next_focus_ar":"تدريب تجريبي","specialist":{"name":"أخصائي (ملف تجريبي)","contact":"demo@example.invalid"}}'::jsonb
$$;
grant execute on function pg_temp.report() to authenticated;
insert into public.consents(child_id,guardian_id,specialist_id,scope,signed_at,expires_at,evidence_path)
values('00000000-0000-4000-a000-000000000010','00000000-0000-4000-a000-000000000004','00000000-0000-4000-a000-000000000002','assessment',now()-interval '1 day',now()+interval '1 day','synthetic-test-evidence-only');
select pg_temp.actor('00000000-0000-4000-a000-000000000002');
set local role authenticated;
insert into public.sessions(id,child_id,type,run_by) values
('00000000-0000-4000-b000-000000000001','00000000-0000-4000-a000-000000000010','assessment','00000000-0000-4000-a000-000000000002'),
('00000000-0000-4000-b000-000000000002','00000000-0000-4000-a000-000000000010','stage0','00000000-0000-4000-a000-000000000003');

select throws_ok($$insert into public.plans(child_id,skill_ids,item_ids) values('00000000-0000-4000-a000-000000000010',array['ls.not_a_real_skill'],array['test-item'])$$,'23514',null,'plans reject IDs absent from canonical skill graph');
select throws_ok($$insert into public.skill_mastery(child_id,skill_id,mastery,source_session_id) values('00000000-0000-4000-a000-000000000010','ls.not_a_real_skill',0.5,'00000000-0000-4000-b000-000000000001')$$,'23514',null,'mastery rejects IDs absent from canonical skill graph');
select throws_ok($$insert into public.children(first_name,grade,birth_month,dialect_lexicon_id,guardian_id,specialist_id,is_demo) values('طفل (ملف تجريبي)',2,'2017-01','unknown','00000000-0000-4000-a000-000000000004','00000000-0000-4000-a000-000000000002',true)$$,'23514',null,'dialects come only from canonical lexicons');
select throws_ok($$insert into public.parent_reports(child_id,session_id,content) values('00000000-0000-4000-a000-000000000010','00000000-0000-4000-b000-000000000001',jsonb_set(pg_temp.report(),'{practised,0,skill_id}','"ls.not_a_real_skill"'))$$,'23514',null,'report rejects unknown skill even if its prefix looks valid');
select throws_ok($$insert into public.parent_reports(child_id,session_id,content) values('00000000-0000-4000-a000-000000000010','00000000-0000-4000-b000-000000000001',pg_temp.report() || '{"risk_score":0.8}'::jsonb)$$,'23514',null,'report rejects extra top-level scored data');
select throws_ok($$insert into public.parent_reports(child_id,session_id,content) values('00000000-0000-4000-a000-000000000010','00000000-0000-4000-b000-000000000001',jsonb_set(pg_temp.report(),'{home_plan,0,words}','[{"risk_score":0.8}]'))$$,'23514',null,'report rejects scored objects hidden in nested word arrays');
select throws_ok($$insert into public.parent_reports(child_id,session_id,content) values('00000000-0000-4000-a000-000000000010','00000000-0000-4000-b000-000000000001',jsonb_set(pg_temp.report(),'{language}','"en"'))$$,'23514',null,'parent report remains Arabic-only at the database boundary');

insert into public.plans(id,child_id,skill_ids,item_ids,approved_by,approved_at)
values('00000000-0000-4000-b000-000000000003','00000000-0000-4000-a000-000000000010',array['ls.alif'],array['test-item'],'00000000-0000-4000-a000-000000000004','2000-01-01');
select ok((select approved_by is null and approved_at is null from public.plans where id='00000000-0000-4000-b000-000000000003'),'draft attribution is cleared even when supplied on insert');
select is((select count(*) from public.approved_practice_plan('00000000-0000-4000-a000-000000000010')),0::bigint,'practice RPC does not expose a draft even to its specialist');
update public.plans set review_status='pending_review',approved_by='00000000-0000-4000-a000-000000000004',approved_at='2000-01-01'
where id='00000000-0000-4000-b000-000000000003';
select ok((select approved_by is null and approved_at is null from public.plans where id='00000000-0000-4000-b000-000000000003'),'pending attribution cannot be spoofed');
select is((select count(*) from public.approved_practice_plan('00000000-0000-4000-a000-000000000010')),0::bigint,'practice RPC does not expose a pending plan');
update public.plans set review_status='approved' where id='00000000-0000-4000-b000-000000000003';
select is((select plan_id from public.approved_practice_plan('00000000-0000-4000-a000-000000000010')),'00000000-0000-4000-b000-000000000003'::uuid,'practice RPC returns only the approved plan');
update public.plans set review_status='delivered' where id='00000000-0000-4000-b000-000000000003';
select is((select count(*) from public.approved_practice_plan('00000000-0000-4000-a000-000000000010')),0::bigint,'practice RPC obeys the approved-only contract, not delivered history');

-- An assigned examiner can submit Stage 0, but the trigger blocks self-approval.
select pg_temp.actor('00000000-0000-4000-a000-000000000003');
insert into public.stage0_results(id,child_id,session_id,request,response,examiner_id)
values('00000000-0000-4000-b000-000000000004','00000000-0000-4000-a000-000000000010','00000000-0000-4000-b000-000000000002','{"synthetic":true}','{"synthetic":true}','00000000-0000-4000-a000-000000000003');
update public.stage0_results set review_status='pending_review' where id='00000000-0000-4000-b000-000000000004';
select throws_ok($$update public.stage0_results set review_status='approved' where id='00000000-0000-4000-b000-000000000004'$$,'42501',null,'assigned examiner cannot bypass specialist approval trigger');
select throws_ok($$update public.stage0_results set review_status='rejected' where id='00000000-0000-4000-b000-000000000004'$$,'42501',null,'assigned examiner cannot reject in place of specialist');
select throws_ok($$update public.stage0_results set response='{"synthetic":true,"tampered":true}' where id='00000000-0000-4000-b000-000000000004'$$,'42501',null,'original Stage 0 scorer JSON is immutable before approval too');

select pg_temp.actor('00000000-0000-4000-a000-000000000001');
select throws_ok($$update public.profiles set role='guardian' where id='00000000-0000-4000-a000-000000000002'$$,'23514',null,'admin must reassign child before changing specialist role');
select throws_ok($$update public.profiles set role='specialist' where id='00000000-0000-4000-a000-000000000004'$$,'23514',null,'admin must reassign child before changing guardian role');
select throws_ok($$update public.profiles set role='guardian' where id='00000000-0000-4000-a000-000000000003'$$,'23514',null,'admin must close active assigned sessions before changing examiner role');
select is((select count(*) from public.audit_log where table_name='plans' and row_id='00000000-0000-4000-b000-000000000003' and action='UPDATE' and before->>'review_status' is distinct from after->>'review_status'),3::bigint,'every approval transition has append-only audit evidence');
reset role;
select ok(not has_table_privilege('authenticated','vault.decrypted_secrets','select'),'authenticated roles cannot read cleanup Vault secrets');

-- Research consent does not authorize any of the session types by itself.
reset role;
insert into public.consents(child_id,guardian_id,specialist_id,scope,signed_at,expires_at,evidence_path,ethics_ref)
values('00000000-0000-4000-a000-000000000011','00000000-0000-4000-a000-000000000006','00000000-0000-4000-a000-000000000005','audio_research',now()-interval '1 day',now()+interval '90 days','synthetic-research-evidence-only','synthetic-ethics-not-a-real-approval');
select pg_temp.actor('00000000-0000-4000-a000-000000000005');
set local role authenticated;
select throws_ok($$insert into public.sessions(child_id,type,run_by) values('00000000-0000-4000-a000-000000000011','assessment','00000000-0000-4000-a000-000000000005')$$,'23514',null,'research consent cannot authorize assessment');
select throws_ok($$insert into public.sessions(child_id,type,run_by) values('00000000-0000-4000-a000-000000000011','stage0','00000000-0000-4000-a000-000000000005')$$,'23514',null,'research consent cannot authorize Stage 0');
select throws_ok($$insert into public.sessions(child_id,type,run_by) values('00000000-0000-4000-a000-000000000011','probe','00000000-0000-4000-a000-000000000005')$$,'23514',null,'research consent cannot authorize probe');
select throws_ok($$insert into public.sessions(child_id,type,run_by) values('00000000-0000-4000-a000-000000000011','practice','00000000-0000-4000-a000-000000000005')$$,'23514',null,'research consent cannot authorize practice');

reset role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select basira_private.configure_audio_cleanup(null,'https://example.invalid/functions/v1/audio-cleanup',repeat('x',32))$$,'22023',null,'null cleanup schedule is rejected');
select throws_ok($$select basira_private.configure_audio_cleanup('*/5 * * * *','http://example.invalid/functions/v1/audio-cleanup',repeat('x',32))$$,'22023',null,'non-HTTPS deployed cleanup endpoint is rejected');
select throws_ok($$select basira_private.configure_audio_cleanup('*/5 * * * *','https://example.invalid/functions/v1/audio-cleanup','short')$$,'22023',null,'weak deployed scheduler secrets are rejected');
-- Configuration is rolled back, so this test never activates future work.
select lives_ok($$select basira_private.configure_audio_cleanup('*/5 * * * *','https://example.invalid/functions/v1/audio-cleanup',repeat('x',32))$$,'native scheduler and encrypted Vault configuration work locally');
select is((select count(*) from cron.job where jobname='basira-audio-cleanup'),1::bigint,'one bounded native cleanup job is configured transactionally');
select ok((select position(repeat('x',32) in command)=0 from cron.job where jobname='basira-audio-cleanup'),'cron metadata never contains the plaintext cleanup secret');
-- Queue this request only within the uncommitted test transaction. pg_net workers
-- cannot observe it before commit, and rollback means no network request occurs.
do $test$
declare command text;
begin
  select j.command into command from cron.job j where jobname='basira-audio-cleanup';
  execute command;
end;
$test$;
select is((select count(*) from net.http_request_queue where url='https://example.invalid/functions/v1/audio-cleanup'),1::bigint,'scheduler produces a bounded HTTP request inside the test transaction');
select ok((select position(repeat('x',32) in headers::text)=0 from net.http_request_queue where url='https://example.invalid/functions/v1/audio-cleanup'),'even a readable pg_net queue never contains the long-lived secret');
select ok((select headers->>'authorization' ~ '^Bearer [0-9a-f]{64}$' and headers->>'x-basira-cleanup-timestamp' ~ '^[0-9]{10,12}$' from net.http_request_queue where url='https://example.invalid/functions/v1/audio-cleanup'),'scheduler sends a timestamped HMAC capability instead of the secret');

select * from finish();
rollback;
