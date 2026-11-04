begin;
select no_plan();

create or replace function pg_temp.set_actor(p_actor uuid, p_app_role text)
returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',p_actor::text,'app_role',p_app_role)::text,true)
$$;
grant execute on function pg_temp.set_actor(uuid,text) to authenticated;

reset role;
insert into auth.users(id,email,encrypted_password) values
  ('00000000-0000-4000-a000-000000007001','b12-guardian@example.invalid',''),
  ('00000000-0000-4000-a000-000000007002','b12-specialist@example.invalid',''),
  ('00000000-0000-4000-a000-000000007003','b12-examiner@example.invalid',''),
  ('00000000-0000-4000-a000-000000007004','b12-admin@example.invalid','')
on conflict (id) do nothing;
update public.profiles set role='guardian' where id='00000000-0000-4000-a000-000000007001';
update public.profiles set role='specialist' where id='00000000-0000-4000-a000-000000007002';
update public.profiles set role='examiner' where id='00000000-0000-4000-a000-000000007003';
update public.profiles set role='admin' where id='00000000-0000-4000-a000-000000007004';
insert into public.children(id,first_name,grade,birth_month,dialect_lexicon_id,guardian_id,specialist_id,is_demo)
values('00000000-0000-4000-a000-000000007010','طفل المرحلة صفر (ملف تجريبي)',3,'2017-01','kw','00000000-0000-4000-a000-000000007001','00000000-0000-4000-a000-000000007002',true);

-- The browser cannot choose a signature time; the trigger records the database time.
select pg_temp.set_actor('00000000-0000-4000-a000-000000007001','guardian');
set local role authenticated;
insert into public.consents(child_id,guardian_id,specialist_id,scope,signed_at,expires_at,evidence_path)
values('00000000-0000-4000-a000-000000007010','00000000-0000-4000-a000-000000007001','00000000-0000-4000-a000-000000007002','assessment','2000-01-01',now()+interval '30 days','synthetic-b12-consent-test-only');
select ok((select signed_at > now()-interval '1 minute' from public.consents where child_id='00000000-0000-4000-a000-000000007010'),'consent signature time is server-recorded');
select is((select evidence_path from public.consents where child_id='00000000-0000-4000-a000-000000007010'),'synthetic-b12-consent-test-only','consent evidence reference is retained unchanged');

-- An examiner can create only a Stage 0 session for themself; the database still checks consent.
select pg_temp.set_actor('00000000-0000-4000-a000-000000007002','specialist');
select throws_ok($$insert into public.sessions(child_id,type,run_by)
  values('00000000-0000-4000-a000-000000007010','stage0','00000000-0000-4000-a000-000000007003')$$,'42501',null,'specialist cannot forge an examiner Stage 0 session');
select pg_temp.set_actor('00000000-0000-4000-a000-000000007004','admin');
select throws_ok($$insert into public.sessions(child_id,type,run_by)
  values('00000000-0000-4000-a000-000000007010','stage0','00000000-0000-4000-a000-000000007003')$$,'42501',null,'admin cannot forge an examiner Stage 0 session');
select pg_temp.set_actor('00000000-0000-4000-a000-000000007003','examiner');
select lives_ok($$insert into public.sessions(id,child_id,type,run_by)
  values('00000000-0000-4000-a000-000000007020','00000000-0000-4000-a000-000000007010','stage0','00000000-0000-4000-a000-000000007003') returning id$$,'assigned examiner can start Stage 0 after consent');
select is((select count(*)::int from public.sessions where id='00000000-0000-4000-a000-000000007020'),1,'examiner INSERT RETURNING creates the Stage 0 session');
select throws_ok($$insert into public.sessions(child_id,type,run_by)
  values('00000000-0000-4000-a000-000000007010','assessment','00000000-0000-4000-a000-000000007003')$$,'42501',null,'examiner cannot start a non-Stage 0 session');

-- A guardian may shorten expiry to revoke, but cannot alter evidence or extend expiry.
select pg_temp.set_actor('00000000-0000-4000-a000-000000007001','guardian');
select lives_ok($$update public.consents set expires_at=now() where child_id='00000000-0000-4000-a000-000000007010'$$,'guardian can revoke by shortening expiry');
select throws_ok($$update public.consents set evidence_path='tampered' where child_id='00000000-0000-4000-a000-000000007010'$$,'42501',null,'consent evidence is immutable');
select pg_temp.set_actor('00000000-0000-4000-a000-000000007003','examiner');
select throws_ok($$insert into public.sessions(child_id,type,run_by)
  values('00000000-0000-4000-a000-000000007010','stage0','00000000-0000-4000-a000-000000007003')$$,'23514',null,'revoked consent blocks a new Stage 0 session');

reset role;
select * from finish();
rollback;
