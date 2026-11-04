begin;
select no_plan();

select is(
  (select p.prorettype::regtype::text
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'basira_health_ping' and p.pronargs = 0),
  'integer',
  'heartbeat returns an integer scalar'
);
select is(
  (select p.provolatile
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'basira_health_ping' and p.pronargs = 0),
  's',
  'heartbeat is STABLE'
);
select ok(
  (select not p.prosecdef
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'basira_health_ping' and p.pronargs = 0),
  'heartbeat is SECURITY INVOKER'
);
select ok(
  (select 'search_path=""' = any(coalesce(p.proconfig, '{}'::text[]))
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'basira_health_ping' and p.pronargs = 0),
  'heartbeat clears the function search_path'
);
select ok(has_function_privilege('anon', 'public.basira_health_ping()', 'EXECUTE'), 'anon can execute the data-free heartbeat');
select ok(has_function_privilege('authenticated', 'public.basira_health_ping()', 'EXECUTE'), 'authenticated can execute the data-free heartbeat');
select ok(
  (select not exists (
     select 1
     from pg_proc p
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'basira_health_ping' and p.pronargs = 0
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'
   )),
  'PUBLIC cannot execute the heartbeat by default'
);
select is(public.basira_health_ping(), 1, 'heartbeat returns exactly scalar 1');
select ok(not has_table_privilege('anon', 'public.profiles', 'SELECT'), 'anon has no profiles table SELECT grant');

set local role anon;
select is(public.basira_health_ping(), 1, 'anon invocation reads no private record');
reset role;
set local role authenticated;
select is(public.basira_health_ping(), 1, 'authenticated invocation reads no private record');
reset role;

select * from finish();
rollback;
