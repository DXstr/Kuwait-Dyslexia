-- B13: a data-free, authenticated-by-PostgREST-key database heartbeat.
-- This is operational plumbing only; it is not a scorer or contract payload.
create or replace function public.basira_health_ping()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select 1;
$$;

-- Do not expose the RPC through the default PUBLIC execute privilege.
revoke all on function public.basira_health_ping() from public;
grant execute on function public.basira_health_ping() to anon, authenticated;
