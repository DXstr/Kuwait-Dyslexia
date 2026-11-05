begin;

select no_plan();

-- Synthetic identities only: these .invalid users are database fixtures, not
-- Google authentication and never contain working credentials.
create function pg_temp.set_actor(p_actor uuid, p_app_role text default 'forged-admin')
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'sub', p_actor::text,
      'app_role', p_app_role
    )::text,
    true
  );
$$;
grant execute on function pg_temp.set_actor(uuid, text) to authenticated;

reset role;
insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000008010', 'synthetic-find-guardian@example.invalid', '',
   '{"full_name":"Synthetic Find Guardian"}'::jsonb),
  ('00000000-0000-0000-0000-000000008011', 'synthetic-find-specialist@example.invalid', '',
   '{"full_name":"Synthetic Find Specialist"}'::jsonb),
  ('00000000-0000-0000-0000-000000008012', 'synthetic-find-examiner@example.invalid', '',
   '{"full_name":"Synthetic Find Examiner"}'::jsonb)
on conflict (id) do nothing;

update public.profiles
set role = 'specialist'
where id = '00000000-0000-0000-0000-000000008011';
update public.profiles
set role = 'examiner'
where id = '00000000-0000-0000-0000-000000008012';

-- A specialist can resolve a guardian's profile id from their email, case- and
-- whitespace-insensitively, and nothing else about that account.
select pg_temp.set_actor('00000000-0000-0000-0000-000000008011', 'specialist');
set local role authenticated;
select is(
  public.find_guardian_by_email('  Synthetic-Find-Guardian@EXAMPLE.invalid  '),
  '00000000-0000-0000-0000-000000008010'::uuid,
  'specialist resolves a guardian id from email regardless of case/whitespace'
);
select is(
  public.find_guardian_by_email('no-such-account@example.invalid'),
  null,
  'an unknown email resolves to null, not an error'
);
select is(
  public.find_guardian_by_email('synthetic-find-specialist@example.invalid'),
  null,
  'a non-guardian account email resolves to null even though the row exists'
);

-- An examiner (not specialist/admin) may not use the lookup at all.
reset role;
select pg_temp.set_actor('00000000-0000-0000-0000-000000008012', 'examiner');
set local role authenticated;
select throws_ok(
  $$select public.find_guardian_by_email('synthetic-find-guardian@example.invalid')$$,
  '42501', NULL::text, 'an examiner cannot resolve a guardian by email'
);

-- Anonymous callers have no grant on the function at all.
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select public.find_guardian_by_email('synthetic-find-guardian@example.invalid')$$,
  '42501', NULL::text, 'anonymous caller cannot call find_guardian_by_email'
);

reset role;
select * from finish();
rollback;
