begin;
select no_plan();

-- Self-contained synthetic identities, never working login credentials.
insert into auth.users(id,email,encrypted_password) values
 ('00000000-0000-4000-a000-000000006001','b6-specialist@example.invalid',''),
 ('00000000-0000-4000-a000-000000006002','b6-guardian@example.invalid',''),
 ('00000000-0000-4000-a000-000000006003','b6-other-specialist@example.invalid',''),
 ('00000000-0000-4000-a000-000000006004','b6-examiner@example.invalid','');
update public.profiles set role='specialist' where id in ('00000000-0000-4000-a000-000000006001','00000000-0000-4000-a000-000000006003');
update public.profiles set role='examiner' where id='00000000-0000-4000-a000-000000006004';
insert into public.children(id,first_name,grade,birth_month,dialect_lexicon_id,guardian_id,specialist_id,is_demo)
values('00000000-0000-4000-a000-000000006010','اختبار التسجيل (ملف تجريبي)',2,'2018-01','kw','00000000-0000-4000-a000-000000006002','00000000-0000-4000-a000-000000006001',true);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-a000-000000006001","app_role":"specialist"}',true);
set local role authenticated;
select throws_ok($$insert into public.sessions(id,child_id,type,run_by) values('00000000-0000-4000-a000-000000006020','00000000-0000-4000-a000-000000006010','assessment','00000000-0000-4000-a000-000000006001') returning id$$,null::text,null::text,'RETURNING cannot bypass missing timestamped guardian consent');
reset role;
insert into public.consents(child_id,guardian_id,specialist_id,scope,signed_at,expires_at,evidence_path)
values('00000000-0000-4000-a000-000000006010','00000000-0000-4000-a000-000000006002','00000000-0000-4000-a000-000000006001','assessment',now()-interval '1 minute',now()+interval '1 day','synthetic-b6-pgtap-not-real-consent');
set local role authenticated;
select lives_ok($$insert into public.sessions(id,child_id,type,run_by) values('00000000-0000-4000-a000-000000006020','00000000-0000-4000-a000-000000006010','assessment','00000000-0000-4000-a000-000000006001') returning id,child_id,started_at,status$$,'assigned specialist can obtain genuine server session acknowledgement');
select is((select count(*)::int from public.sessions where id='00000000-0000-4000-a000-000000006020'),1,'assigned specialist reads the created session');
select lives_ok($$update public.sessions set status='completed' where id='00000000-0000-4000-a000-000000006020' returning id,status$$,'assigned specialist can acknowledge completion with RETURNING');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-a000-000000006003","app_role":"admin"}',true);
select is((select count(*)::int from public.sessions where id='00000000-0000-4000-a000-000000006020'),0,'unassigned specialist cannot read assessment even with forged admin claim');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-a000-000000006002","app_role":"admin"}',true);
select is((select count(*)::int from public.sessions where id='00000000-0000-4000-a000-000000006020'),0,'guardian cannot read raw assessment session');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-a000-000000006004","app_role":"examiner"}',true);
select is((select count(*)::int from public.sessions where id='00000000-0000-4000-a000-000000006020'),0,'Stage 0 examiner cannot read specialist assessment');
select * from finish();
rollback;
