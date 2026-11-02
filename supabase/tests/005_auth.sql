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
  ('00000000-0000-0000-0000-000000005010', 'synthetic-oauth-guardian@example.invalid', '',
   '{"role":"admin","app_role":"admin","full_name":"Synthetic OAuth Guardian"}'::jsonb),
  ('00000000-0000-0000-0000-000000005011', 'synthetic-oauth-specialist@example.invalid', '',
   '{"role":"admin","app_role":"admin","full_name":"Synthetic OAuth Specialist"}'::jsonb),
  ('00000000-0000-0000-0000-000000005012', 'synthetic-oauth-examiner@example.invalid', '',
   '{"role":"guardian","app_role":"guardian","full_name":"Synthetic OAuth Examiner"}'::jsonb),
  ('00000000-0000-0000-0000-000000005013', 'synthetic-oauth-admin@example.invalid', '',
   '{"role":"guardian","app_role":"guardian","full_name":"Synthetic OAuth Admin"}'::jsonb),
  ('00000000-0000-0000-0000-000000005014', 'synthetic-oauth-other-guardian@example.invalid', '',
   '{"role":"admin","app_role":"admin","full_name":"Synthetic OAuth Other Guardian"}'::jsonb)
on conflict (id) do nothing;

-- Auth-created profiles are guardian regardless of forged metadata.  The
-- trusted role changes below are explicit fixture setup, not an application path.
select is(
  (select count(*)::int from public.profiles
   where id between '00000000-0000-0000-0000-000000005010'::uuid
             and '00000000-0000-0000-0000-000000005014'::uuid
     and role = 'guardian'),
  5,
  'every synthetic Auth user starts as guardian despite forged role/app_role metadata'
);
select is(
  (select count(*)::int from auth.users
   where id between '00000000-0000-0000-0000-000000005010'::uuid
             and '00000000-0000-0000-0000-000000005014'::uuid
     and coalesce(encrypted_password, '') <> ''),
  0,
  'synthetic OAuth fixtures have no working password credentials'
);

update public.profiles as p
set role = v.role,
    display_name = v.display_name
from (values
  ('00000000-0000-0000-0000-000000005010'::uuid, 'guardian'::text, 'Synthetic guardian'),
  ('00000000-0000-0000-0000-000000005011'::uuid, 'specialist'::text, 'Synthetic specialist'),
  ('00000000-0000-0000-0000-000000005012'::uuid, 'examiner'::text, 'Synthetic examiner'),
  ('00000000-0000-0000-0000-000000005013'::uuid, 'admin'::text, 'Synthetic admin'),
  ('00000000-0000-0000-0000-000000005014'::uuid, 'guardian'::text, 'Synthetic other guardian')
) as v(id, role, display_name)
where p.id = v.id;

-- A forged claim cannot choose the hook role. The hook reads profiles.role for
-- every application role, while preserving the rest of the event claims.
select is(
  (public.custom_access_token_hook(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000005010',
    'claims', jsonb_build_object('role', 'authenticated', 'app_role', 'forged-admin')
  )) #>> '{claims,app_role}'),
  'guardian',
  'hook emits the profile-backed guardian role, not forged claims'
);
select is(
  (public.custom_access_token_hook(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000005011',
    'claims', jsonb_build_object('role', 'authenticated', 'app_role', 'forged-guardian')
  )) #>> '{claims,app_role}'),
  'specialist',
  'hook emits the profile-backed specialist role, not forged claims'
);
select is(
  (public.custom_access_token_hook(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000005012',
    'claims', jsonb_build_object('role', 'authenticated', 'app_role', 'forged-admin')
  )) #>> '{claims,app_role}'),
  'examiner',
  'hook emits the profile-backed examiner role, not forged claims'
);
select is(
  (public.custom_access_token_hook(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000005013',
    'claims', jsonb_build_object('role', 'authenticated', 'app_role', 'forged-guardian')
  )) #>> '{claims,app_role}'),
  'admin',
  'hook emits the profile-backed admin role, not forged claims'
);

-- A trusted provisioning change is visible on the next hook invocation. Keep
-- both guardian fixtures intact for the guardian-to-guardian RLS assertions.
update public.profiles
set role = 'examiner'
where id = '00000000-0000-0000-0000-000000005011';
select is(
  (public.custom_access_token_hook(jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000005011',
    'claims', jsonb_build_object('role', 'authenticated', 'app_role', 'stale-guardian')
  )) #>> '{claims,app_role}'),
  'examiner',
  'hook reflects a trusted profile role change immediately'
);

-- Profile RLS is identity-scoped. The guardian can read self but not another
-- guardian, and cannot promote the own profile through the authenticated API.
select pg_temp.set_actor('00000000-0000-0000-0000-000000005014', 'admin');
set local role authenticated;
select is((select count(*)::int from public.profiles
           where id = '00000000-0000-0000-0000-000000005014'), 1,
          'caller can read own profile');
select is((select count(*)::int from public.profiles
           where id = '00000000-0000-0000-0000-000000005010'), 0,
          'caller cannot read another guardian profile');
select throws_ok(
  $$update public.profiles set role = 'admin'
    where id = '00000000-0000-0000-0000-000000005014'$$,
  '42501', NULL::text, 'caller cannot update own profile role'
);

-- Anonymous callers have neither a public grant nor a profile policy path.
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select count(*) from public.profiles$$,
  '42501', NULL::text, 'anonymous caller cannot read profiles'
);

reset role;
select * from finish();
rollback;
