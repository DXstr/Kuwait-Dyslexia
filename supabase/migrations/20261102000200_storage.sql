-- B3: private storage, canonical object paths, and service-only audio cleanup.
-- The preceding core migration owns the public tables and basira_private access helpers.

begin;

-- Keep uploaded files bounded and typed at the Storage service boundary as well as in RLS.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('audio', 'audio', false, 10485760, array['audio/wav']::text[]),
  ('reports', 'reports', false, 10485760, array['application/pdf']::text[])
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- The stored item_results value is only a baseline. A current, matching research
-- consent is evaluated at read/cleanup time, so shortening or expiry takes effect
-- immediately without mutating scorer response JSON or persisting an extension.
create or replace function basira_private.audio_retention_deadline(
  p_item_result_id uuid,
  p_at timestamptz default now()
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

  -- Core insert policy forces the default. LEAST also makes an explicit earlier
  -- deadline authoritative and prevents a client-supplied later date extending it.
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

comment on function basira_private.audio_retention_deadline(uuid, timestamptz) is
  'Computes the current audio deadline: an earlier explicit baseline wins; valid matching audio_research consent can extend only the 30-day baseline.';

-- Storage policies call this helper under the function owner. Authenticated users
-- need execute permission for policy evaluation, but the function exposes only a
-- retention timestamp and never raw response/audio data.
revoke execute on function basira_private.audio_retention_deadline(uuid, timestamptz) from public;
grant execute on function basira_private.audio_retention_deadline(uuid, timestamptz) to authenticated;

-- Canonical paths and access are evaluated by a SECURITY DEFINER helper. It
-- deliberately trusts the current profile role and relational assignments, not
-- JWT app_role/user metadata. Guardians never receive audio access; examiners
-- are read-only and require current assessment consent; every write requires
-- current consent and an assigned specialist/admin actor.
create or replace function basira_private.can_access_audio_object(
  p_path text,
  p_writing boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, basira_private
as $$
  select exists (
    select 1
    from public.item_results ir
    join public.sessions s on s.id = ir.session_id
    join public.children c on c.id = s.child_id
    where ir.audio_path = p_path
      and p_path = format('audio/%s/%s/%s.wav', c.id, s.id, ir.item_id)
      and basira_private.audio_retention_deadline(ir.id, now()) > now()
      and (
        (
          basira_private.current_role() in ('specialist', 'admin')
          and basira_private.can_manage_child(c.id)
          and basira_private.can_access_session(s.id)
          and (not p_writing or basira_private.has_consent(c.id, s.type, now()))
        )
        or (
          not p_writing
          and basira_private.current_role() = 'examiner'
          and s.type = 'stage0'
          and s.run_by = auth.uid()
          and basira_private.can_access_session(s.id)
          and basira_private.has_consent(c.id, s.type, now())
        )
      )
  )
$$;

comment on function basira_private.can_access_audio_object(text, boolean) is
  'Authorizes canonical audio reads/writes from current profile role, assignments, current consent, and effective retention.';

revoke all on function basira_private.can_access_audio_object(text, boolean) from public, anon;
grant execute on function basira_private.can_access_audio_object(text, boolean) to authenticated;

drop policy if exists audio_objects_select on storage.objects;
create policy audio_objects_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'audio'
  and basira_private.can_access_audio_object(name, false)
);

drop policy if exists audio_objects_insert on storage.objects;
create policy audio_objects_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'audio'
  and basira_private.can_access_audio_object(name, true)
);

-- Audio is immutable. Cleanup removes the relational pointer only after the
-- Storage API deletes bytes; no authenticated SQL update policy is provided.
drop policy if exists audio_objects_update on storage.objects;

-- No client delete policy is intentional: only the cleanup Edge Function's
-- service-role Storage API call may delete bytes. There is also no audio policy
-- for guardians, and expired objects fail the SELECT policy.

create policy report_objects_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'reports'
  and name like 'reports/%'
  and exists (
    select 1
    from public.parent_reports pr
    join public.children c on c.id = pr.child_id
    where pr.pdf_path = storage.objects.name
      and storage.objects.name = format('reports/%s/%s.pdf', c.id, pr.id)
      and (
        (
          basira_private.is_guardian(c.id)
          and pr.review_status in ('approved', 'delivered')
        )
        or basira_private.can_manage_child(c.id)
      )
  )
);

create policy report_objects_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'reports'
  and name like 'reports/%'
  and exists (
    select 1
    from public.parent_reports pr
    join public.children c on c.id = pr.child_id
    where pr.pdf_path = storage.objects.name
      and storage.objects.name = format('reports/%s/%s.pdf', c.id, pr.id)
      and pr.review_status = 'draft'
      and basira_private.can_manage_child(c.id)
  )
);

create policy report_objects_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'reports'
  and name like 'reports/%'
  and exists (
    select 1
    from public.parent_reports pr
    join public.children c on c.id = pr.child_id
    where pr.pdf_path = storage.objects.name
      and storage.objects.name = format('reports/%s/%s.pdf', c.id, pr.id)
      and pr.review_status = 'draft'
      and basira_private.can_manage_child(c.id)
  )
)
with check (
  bucket_id = 'reports'
  and name like 'reports/%'
  and exists (
    select 1
    from public.parent_reports pr
    join public.children c on c.id = pr.child_id
    where pr.pdf_path = storage.objects.name
      and storage.objects.name = format('reports/%s/%s.pdf', c.id, pr.id)
      and pr.review_status = 'draft'
      and basira_private.can_manage_child(c.id)
  )
);

-- Service-only cleanup discovery. It returns rows, never deletes storage.objects.
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
         basira_private.audio_retention_deadline(ir.id, now())
  from public.item_results ir
  where ir.audio_path is not null
    and basira_private.audio_retention_deadline(ir.id, now()) <= now()
  order by basira_private.audio_retention_deadline(ir.id, now()), ir.id
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

  -- Validate the complete request before touching any item_result. Explicitly
  -- checking JSON types keeps malformed service payloads from becoming casts
  -- with implementation-specific error details.
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
     and basira_private.audio_retention_deadline(ir.id, now()) <= now()
     and not exists (
           select 1
           from storage.objects so
           where so.bucket_id = 'audio'
             and so.name = ir.audio_path
         )
  returning ir.id;
end;
$$;

comment on function public.expired_audio_paths(integer) is
  'Service-role-only discovery of currently expired audio; deletion is performed through the Storage API.';
comment on function public.confirm_audio_deleted(jsonb) is
  'Service-role-only, race-safe acknowledgement of validated item/path pairs after Storage API deletion; clears audio_path only while still expired and absent from storage.objects.';

revoke all on function public.expired_audio_paths(integer) from public, anon, authenticated;
revoke all on function public.confirm_audio_deleted(jsonb) from public, anon, authenticated;
-- Supabase always supplies service_role. The guarded grants keep plain Postgres
-- migration linting possible where that role is not installed yet.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.expired_audio_paths(integer) to service_role';
    execute 'grant execute on function public.confirm_audio_deleted(jsonb) to service_role';
  end if;
end;
$$;

-- Optional Supabase-native scheduler support. Extensions are created only when the
-- target installation advertises them; deployment can call configure_audio_cleanup
-- after the Edge Function URL and secret exist. No secret is stored in this repo.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      execute 'create extension if not exists pg_cron with schema extensions';
    exception when others then
      raise notice 'pg_cron is available but was not enabled; configure_audio_cleanup remains manual';
    end;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      execute 'create extension if not exists pg_net with schema extensions';
    exception when others then
      raise notice 'pg_net is available but was not enabled; configure_audio_cleanup remains manual';
    end;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    begin
      execute 'create extension if not exists supabase_vault with schema vault';
    exception when others then
      raise notice 'supabase_vault is available but was not enabled; configure_audio_cleanup remains manual';
    end;
  end if;
end;
$$;

-- Extension-owned pg_net queues may be readable by database roles. Never enqueue
-- the long-lived secret: sign a timestamped, one-minute cleanup capability instead.
create extension if not exists pgcrypto with schema extensions;

create or replace function basira_private.configure_audio_cleanup(
  p_schedule text,
  p_url text,
  p_secret text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, basira_private
as $$
declare
  v_command text;
  v_role text;
begin
  v_role := coalesce(nullif(auth.jwt() ->> 'role', ''), nullif(current_setting('role', true), ''), nullif(auth.role(), ''));
  if v_role <> 'service_role'
     and not (session_user = 'postgres' and coalesce(v_role, 'postgres') in ('postgres', 'none')) then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_schedule is distinct from '*/5 * * * *' then
    raise exception using errcode = '22023', message = 'only the five-minute cleanup schedule is supported';
  end if;
  if p_url is null or p_url !~ '^https://[^/]+/functions/v1/audio-cleanup/?$' then
    raise exception using errcode = '22023', message = 'p_url must be an HTTPS Supabase Edge Function URL';
  end if;
  if p_secret is null or octet_length(p_secret) < 32 then
    raise exception using errcode = '22023', message = 'cleanup secret must be at least 32 bytes';
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'cron')
     or not exists (select 1 from pg_namespace where nspname = 'net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise exception using errcode = '55000', message = 'pg_cron, pg_net, and supabase_vault must be enabled before configuring cleanup';
  end if;

  -- Replace the named Vault secret atomically from the scheduler's perspective.
  execute 'delete from vault.secrets where name = ''basira_audio_cleanup_secret''';
  execute $sql$
    select vault.create_secret($1, 'basira_audio_cleanup_secret', 'Basira audio cleanup Edge Function shared secret')
  $sql$ using p_secret;

  execute $sql$
    select cron.unschedule(jobid)
    from cron.job
    where jobname = 'basira-audio-cleanup'
  $sql$;

  v_command := format($command$
    with invocation as (
      select floor(extract(epoch from clock_timestamp()))::bigint::text as stamp
    )
    select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-basira-cleanup-timestamp', invocation.stamp,
        'authorization', 'Bearer ' || encode(extensions.hmac(
          'basira-audio-cleanup:' || invocation.stamp,
          (select decrypted_secret from vault.decrypted_secrets where name = 'basira_audio_cleanup_secret'),
          'sha256'
        ), 'hex')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) from invocation;
  $command$, p_url);
  execute 'select cron.schedule(''basira-audio-cleanup'', $1, $2)' using p_schedule, v_command;
end;
$$;

comment on function basira_private.configure_audio_cleanup(text, text, text) is
  'Service-role/postgres-only setup for the five-minute pg_cron -> pg_net -> audio-cleanup Edge Function path; stores the secret in Vault.';
revoke all on function basira_private.configure_audio_cleanup(text, text, text) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function basira_private.configure_audio_cleanup(text, text, text) to service_role';
  end if;
end;
$$;

commit;
