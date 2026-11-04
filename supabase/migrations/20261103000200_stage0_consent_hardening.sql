-- B12: consent evidence is recorded with the database clock, and the examiner-only
-- Stage 0 route may create only its own Stage 0 session. Child assignment,
-- specialist-of-record and assessment-consent checks remain server enforced.
alter table public.consents alter column signed_at set default statement_timestamp();

-- Consent signatures are recorded with statement_timestamp().  Authorization
-- checks must use the wall clock rather than transaction-start now(), or a
-- consent captured earlier in the same transaction would appear to be from
-- the future and reject the session/result that follows it.
create or replace function basira_private.has_consent(child uuid, session_type text, at_time timestamptz default clock_timestamp()) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.consents co join public.children c on c.id = co.child_id
    where c.id = child and co.guardian_id = c.guardian_id and co.specialist_id = c.specialist_id
      and co.scope = case when session_type = 'practice' then 'practice'
        when session_type in ('assessment','stage0','probe') then 'assessment' else null end
      and co.signed_at <= at_time and co.expires_at > at_time)
$$;

create or replace function basira_private.can_write_result(session uuid, allow_examiner boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.sessions s where s.id = session and s.status <> 'abandoned'
    and basira_private.has_consent(s.child_id,s.type,clock_timestamp())
    and (basira_private.can_manage_child(s.child_id) or
      (allow_examiner and basira_private.current_role() = 'examiner' and s.type = 'stage0' and s.run_by = (select auth.uid()))))
$$;

-- The base platform migration declares these grants, but installations that
-- already applied the contract-validation migration can retain its initial
-- revoke. Keep the intended least-privilege constraint access explicit here.
grant execute on function basira_private.canonical_skill_ids(), basira_private.canonical_dialect_ids() to authenticated;

create or replace function basira_private.guard_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.children c where c.id=new.child_id and c.guardian_id=new.guardian_id and c.specialist_id=new.specialist_id) then
    raise exception 'consent must match current guardian and specialist' using errcode='23514';
  end if;
  if tg_op='INSERT' then
    -- Do not trust browser clocks. The actual signature time is the database time.
    new.signed_at := statement_timestamp();
    if not basira_private.is_database_admin() and not basira_private.is_guardian(new.child_id) then
      raise exception 'only the recorded guardian can sign consent' using errcode='42501';
    end if;
  else
    if (to_jsonb(new)-'expires_at') is distinct from (to_jsonb(old)-'expires_at') or new.expires_at > old.expires_at then
      raise exception 'consent evidence is immutable; only shortening expiry is permitted' using errcode='42501';
    end if;
    -- Revocation is recorded against the database clock, never a browser clock.
    new.expires_at := least(statement_timestamp(), old.expires_at);
  end if;
  return new;
end $$;

create or replace function basira_private.guard_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare supervisor_role text;
begin
  if tg_op='INSERT' then
    new.started_at := statement_timestamp();
    if new.status <> 'in_progress' or new.ended_at is not null then raise exception 'session must start in progress' using errcode='23514'; end if;
    select role into supervisor_role from public.profiles where id=new.run_by;
    if new.type = 'stage0' then
      if basira_private.current_role() <> 'examiner' or new.run_by <> (select auth.uid()) or supervisor_role <> 'examiner' then
        raise exception 'Stage 0 sessions require the authenticated examiner as run_by' using errcode='42501';
      end if;
    else
      if not basira_private.can_manage_child(new.child_id) or supervisor_role <> 'specialist' then
        raise exception 'non-Stage 0 sessions require the assigned specialist' using errcode='42501';
      end if;
      if not exists(select 1 from public.children where id=new.child_id and specialist_id=new.run_by) then
        raise exception 'supervisor must be specialist of record' using errcode='42501';
      end if;
    end if;
    if not basira_private.has_consent(new.child_id,new.type,new.started_at) then raise exception 'valid guardian consent required' using errcode='23514'; end if;
  else
    if (new.id,new.child_id,new.type,new.started_at,new.run_by) is distinct from (old.id,old.child_id,old.type,old.started_at,old.run_by) then
      raise exception 'session identity and assignment are immutable' using errcode='42501';
    end if;
    if not basira_private.can_access_session(old.id) then raise exception 'session access denied' using errcode='42501'; end if;
    if old.status <> 'in_progress' and to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'session is terminal' using errcode='23514'; end if;
    if new.status in ('completed','abandoned') and old.status='in_progress' then new.ended_at := statement_timestamp();
    elsif new.ended_at is distinct from old.ended_at then raise exception 'session end time is server controlled' using errcode='42501'; end if;
  end if;
  return new;
end $$;

drop policy session_insert on public.sessions;
create policy session_insert on public.sessions for insert to authenticated with check (
  (type = 'stage0' and basira_private.current_role() = 'examiner' and run_by = (select auth.uid()))
  or (type <> 'stage0' and basira_private.current_role() = 'specialist' and basira_private.can_manage_child(child_id) and run_by = (select auth.uid()))
);
drop policy child_read on public.children;
create policy child_read on public.children for select to authenticated using (
  basira_private.can_manage_child(id)
  or (basira_private.current_role() = 'guardian' and guardian_id = (select auth.uid()))
  or (basira_private.current_role() = 'examiner' and is_demo)
);

-- Effective audio expiry must evaluate consent against the wall clock. A
-- server-clocked revocation can occur after transaction-start now(), and must
-- not keep a research-retention extension alive for the rest of that transaction.
create or replace function basira_private.audio_retention_deadline(
  p_item_result_id uuid,
  p_at timestamptz default clock_timestamp()
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog, public, basira_private
as $$
declare
  v_child_id uuid;
  v_started_at timestamptz;
  v_explicit_deadline timestamptz;
  v_default_deadline timestamptz;
  v_research_deadline timestamptz;
begin
  select c.id, s.started_at, ir.audio_expires_at
    into v_child_id, v_started_at, v_explicit_deadline
  from public.item_results ir
  join public.sessions s on s.id = ir.session_id
  join public.children c on c.id = s.child_id
  where ir.id = p_item_result_id;

  if v_child_id is null or v_started_at is null then
    return null;
  end if;

  v_default_deadline := v_started_at + interval '30 days';

  -- An earlier explicit deadline remains authoritative; research consent can
  -- extend only the 30-day baseline and only while valid at the wall clock.
  if v_explicit_deadline is not null
     and v_explicit_deadline < v_default_deadline then
    return v_explicit_deadline;
  end if;

  select max(co.expires_at)
    into v_research_deadline
  from public.consents co
  join public.children c on c.id = co.child_id
  where co.child_id = v_child_id
    and co.guardian_id = c.guardian_id
    and co.specialist_id = c.specialist_id
    and co.scope = 'audio_research'
    and co.signed_at <= v_started_at
    and co.expires_at > p_at;

  return greatest(v_default_deadline, coalesce(v_research_deadline, v_default_deadline));
end;
$$;

-- Cleanup runs can revoke consent and discover due audio in the same database
-- transaction. Use one wall-clock instant per RPC rather than transaction-start
-- now(), otherwise a server-clocked revocation remains visible as valid until the
-- transaction commits.
create or replace function public.expired_audio_paths(batch_size integer default 100)
returns table (
  item_result_id uuid,
  object_path text,
  effective_deadline timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, basira_private
as $$
declare
  v_role text;
  v_now timestamptz := clock_timestamp();
begin
  v_role := coalesce(nullif(auth.jwt() ->> 'role', ''), nullif(current_setting('role', true), ''), nullif(auth.role(), ''));
  if v_role <> 'service_role'
     and not (session_user = 'postgres' and coalesce(v_role, 'postgres') in ('postgres', 'none')) then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  if batch_size is null or batch_size < 1 or batch_size > 1000 then
    raise exception using errcode = '22023', message = 'batch_size must be between 1 and 1000';
  end if;

  return query
  select ir.id,
         ir.audio_path,
         basira_private.audio_retention_deadline(ir.id, v_now)
  from public.item_results ir
  where ir.audio_path is not null
    and basira_private.audio_retention_deadline(ir.id, v_now) <= v_now
  order by basira_private.audio_retention_deadline(ir.id, v_now), ir.id
  limit batch_size;
end;
$$;

create or replace function public.confirm_audio_deleted(items jsonb)
returns table (item_result_id uuid)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, basira_private
as $$
declare
  v_role text;
  v_item jsonb;
  v_item_result_id uuid;
  v_object_path text;
  v_now timestamptz := clock_timestamp();
begin
  v_role := coalesce(nullif(auth.jwt() ->> 'role', ''), nullif(current_setting('role', true), ''), nullif(auth.role(), ''));
  if v_role <> 'service_role'
     and not (session_user = 'postgres' and coalesce(v_role, 'postgres') in ('postgres', 'none')) then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  if items is null or jsonb_typeof(items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'items must be a JSON array';
  end if;
  if jsonb_array_length(items) < 1 or jsonb_array_length(items) > 1000 then
    raise exception using errcode = '22023', message = 'items must contain between 1 and 1000 pairs';
  end if;

  for v_item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item -> 'item_result_id') is distinct from 'string'
       or jsonb_typeof(v_item -> 'object_path') is distinct from 'string'
       or v_item ->> 'object_path' = '' then
      raise exception using errcode = '22023', message = 'items must contain {item_result_id, object_path} pairs';
    end if;
    begin
      v_item_result_id := (v_item ->> 'item_result_id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'item_result_id must be a UUID';
    end;
    v_object_path := v_item ->> 'object_path';
  end loop;

  return query
  update public.item_results ir
     set audio_path = null
   where exists (
           select 1
           from jsonb_array_elements(items) pair
           where (pair ->> 'item_result_id')::uuid = ir.id
             and pair ->> 'object_path' = ir.audio_path
         )
     and ir.audio_path is not null
     and basira_private.audio_retention_deadline(ir.id, v_now) <= v_now
     and not exists (
           select 1
           from storage.objects so
           where so.bucket_id = 'audio'
             and so.name = ir.audio_path
         )
  returning ir.id;
end;
$$;
