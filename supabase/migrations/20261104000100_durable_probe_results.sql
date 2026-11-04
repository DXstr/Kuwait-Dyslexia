-- B10: durable ProbeResponse acknowledgement and atomic probe finalization.
-- The canonical response JSON is validated by the generated
-- basira_private.probe_response_schema() helper. No client may insert or
-- mutate probe evidence directly; finalize_probe is the only application path.
create table public.probe_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions(id),
  child_id uuid not null references public.children(id),
  event_id uuid not null,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  synthetic boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (child_id, event_id),
  check (response ? 'synthetic' and jsonb_typeof(response->'synthetic') = 'boolean'
    and (response->>'synthetic')::boolean = synthetic)
);
create index probe_results_child_created on public.probe_results(child_id, created_at desc);
create index probe_results_session on public.probe_results(session_id);

create function basira_private.guard_probe_session_actor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.type = 'probe' then
    if basira_private.current_role() <> 'specialist' then
      raise exception 'probe sessions require the assigned specialist actor' using errcode='42501';
    end if;
    -- The authenticated actor, not client metadata, owns the session.
    new.run_by := auth.uid();
  end if;
  return new;
end $$;
create trigger guard_probe_session_actor
before insert on public.sessions for each row
execute function basira_private.guard_probe_session_actor();

create function basira_private.guard_probe_completion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.type = 'probe' and new.status = 'completed'
     and not exists (select 1 from public.probe_results p where p.session_id = old.id) then
    raise exception 'probe completion requires an acknowledged probe result' using errcode='23514';
  end if;
  return new;
end $$;
create trigger guard_probe_completion
before update on public.sessions for each row
execute function basira_private.guard_probe_completion();

create function basira_private.guard_probe_result() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  session_row public.sessions;
begin
  if tg_op <> 'INSERT' then
    raise exception 'probe results are append-only' using errcode='42501';
  end if;
  select * into session_row from public.sessions where id = new.session_id;
  if not found or session_row.type <> 'probe' or session_row.status = 'abandoned' then
    raise exception 'probe result requires an active probe session' using errcode='23514';
  end if;
  if not basira_private.can_manage_child(session_row.child_id)
     or not basira_private.has_consent(session_row.child_id, 'probe', statement_timestamp()) then
    raise exception 'probe result requires assigned specialist and valid consent' using errcode='42501';
  end if;
  if new.child_id is distinct from session_row.child_id then
    raise exception 'probe child_id must match the session child_id' using errcode='23514';
  end if;
  if not extensions.jsonb_matches_schema(basira_private.probe_response_schema(), new.response) then
    raise exception 'probe response must match the canonical ProbeResponse contract' using errcode='23514';
  end if;
  if new.response->>'session_id' <> new.session_id::text then
    raise exception 'probe response session_id must match session_id' using errcode='23514';
  end if;
  if new.synthetic is distinct from (new.response->>'synthetic')::boolean then
    raise exception 'probe synthetic marker must match response.synthetic' using errcode='23514';
  end if;
  -- These fields are database-owned even if a privileged caller supplies them.
  new.child_id := session_row.child_id;
  new.id := gen_random_uuid();
  new.created_at := clock_timestamp();
  return new;
end $$;
create trigger guard_probe_result
before insert on public.probe_results for each row
execute function basira_private.guard_probe_result();
create trigger immutable_probe_result
before update or delete or truncate on public.probe_results for each statement
execute function basira_private.reject_mutation();
create trigger log_probe_result
after insert on public.probe_results for each row
execute function basira_private.write_audit();

create or replace function public.finalize_probe(
  p_session_id uuid,
  p_event_id uuid,
  p_response jsonb
)
returns table (
  id uuid,
  session_id uuid,
  child_id uuid,
  event_id uuid,
  response jsonb,
  synthetic boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.sessions;
  existing_row public.probe_results;
  saved_row public.probe_results;
  actor uuid := auth.uid();
  response_synthetic boolean;
begin
  if basira_private.current_role() not in ('specialist', 'admin') then
    raise exception 'probe finalization requires a specialist or admin' using errcode='42501';
  end if;
  select * into session_row
  from public.sessions
  where public.sessions.id = p_session_id
  for update;
  if not found or session_row.type <> 'probe' or session_row.status = 'abandoned' then
    raise exception 'probe session is unavailable' using errcode='23514';
  end if;
  if not basira_private.can_manage_child(session_row.child_id)
     or not basira_private.has_consent(session_row.child_id, 'probe', statement_timestamp()) then
    raise exception 'probe finalization requires assigned specialist and valid consent' using errcode='42501';
  end if;
  if not extensions.jsonb_matches_schema(basira_private.probe_response_schema(), p_response) then
    raise exception 'probe response must match the canonical ProbeResponse contract' using errcode='23514';
  end if;
  if p_response->>'session_id' <> p_session_id::text then
    raise exception 'probe response session_id must match session_id' using errcode='23514';
  end if;
  response_synthetic := (p_response->>'synthetic')::boolean;

  -- A retry is a read of the exact immutable acknowledgement. It never
  -- changes its server timestamp and never creates another cycle.
  select * into existing_row
  from public.probe_results
  where probe_results.session_id = p_session_id
  for update;
  if found then
    if existing_row.child_id = session_row.child_id
       and existing_row.event_id = p_event_id
       and existing_row.synthetic = response_synthetic
       and existing_row.response = p_response then
      if session_row.status = 'in_progress' then
        update public.sessions set status = 'completed'
        where public.sessions.id = p_session_id and public.sessions.status = 'in_progress';
      end if;
      return query select existing_row.id, existing_row.session_id, existing_row.child_id,
        existing_row.event_id, existing_row.response, existing_row.synthetic, existing_row.created_at;
      return;
    end if;
    raise exception 'conflicting probe retry' using errcode='23505';
  end if;
  if session_row.status <> 'in_progress' then
    raise exception 'completed probe has no matching acknowledgement' using errcode='23514';
  end if;
  if exists (select 1 from public.probe_results p where p.child_id = session_row.child_id and p.event_id = p_event_id) then
    raise exception 'probe event_id already belongs to another session' using errcode='23505';
  end if;

  insert into public.probe_results(session_id, child_id, event_id, response, synthetic)
  values (p_session_id, session_row.child_id, p_event_id, p_response, response_synthetic)
  returning * into saved_row;
  update public.sessions set status = 'completed'
  where public.sessions.id = p_session_id and public.sessions.status = 'in_progress';
  if not found then
    raise exception 'probe completion acknowledgement failed' using errcode='23514';
  end if;
  return query select saved_row.id, saved_row.session_id, saved_row.child_id,
    saved_row.event_id, saved_row.response, saved_row.synthetic, saved_row.created_at;
end $$;
revoke all on function public.finalize_probe(uuid, uuid, jsonb) from public, anon;
grant execute on function public.finalize_probe(uuid, uuid, jsonb) to authenticated;

alter table public.probe_results enable row level security;
revoke all on public.probe_results from public, anon, authenticated;
grant select on public.probe_results to authenticated;
create policy probe_result_read on public.probe_results
for select to authenticated
using (basira_private.can_manage_child(child_id));
-- There is intentionally no authenticated INSERT/UPDATE/DELETE policy. The
-- SECURITY DEFINER RPC is the single validated, audited write boundary.

grant execute on function basira_private.probe_response_schema() to authenticated;
