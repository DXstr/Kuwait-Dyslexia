-- Basira B3: existing v0.1.0 contract, no scorer-payload rewriting.
create schema if not exists basira_private;
revoke all on schema basira_private from public, anon;
revoke create on schema public from public, anon, authenticated;
grant usage on schema basira_private to authenticated, service_role, supabase_auth_admin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  role text not null default 'guardian' check (role in ('guardian','specialist','examiner','admin')),
  display_name text not null check (length(btrim(display_name)) > 0)
);
create table public.children (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (length(btrim(first_name)) > 0),
  grade integer not null check (grade between 1 and 6),
  birth_month text not null check (birth_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  dialect_lexicon_id text not null check (dialect_lexicon_id = any(basira_private.canonical_dialect_ids())),
  guardian_id uuid not null references public.profiles(id),
  specialist_id uuid not null references public.profiles(id),
  is_demo boolean not null default false,
  check (not is_demo or position('(ملف تجريبي)' in first_name) > 0)
);
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id),
  guardian_id uuid not null references public.profiles(id),
  specialist_id uuid not null references public.profiles(id),
  scope text not null check (scope in ('assessment','practice','audio_research')),
  signed_at timestamptz not null,
  expires_at timestamptz not null,
  evidence_path text not null check (length(btrim(evidence_path)) > 0),
  ethics_ref text,
  check (expires_at > signed_at),
  check (scope <> 'audio_research' or (ethics_ref is not null and length(btrim(ethics_ref)) > 0))
);
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id),
  type text not null check (type in ('stage0','assessment','practice','probe')),
  status text not null default 'in_progress' check (status in ('in_progress','completed','abandoned')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  run_by uuid not null references public.profiles(id),
  check (ended_at is null or ended_at >= started_at)
);
create table public.item_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  item_id text not null check (length(btrim(item_id)) > 0 and strpos(item_id,'/') = 0 and strpos(item_id,chr(92)) = 0 and item_id !~ '[[:cntrl:]]'),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  audio_path text,
  audio_expires_at timestamptz not null default now() + interval '30 days',
  synthetic boolean not null,
  check (response ? 'synthetic' and jsonb_typeof(response->'synthetic') = 'boolean' and (response->>'synthetic')::boolean = synthetic)
);
create table public.tap_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  item_id text not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object')
);
create table public.fingerprints (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  review_status text not null default 'pending_review' check (review_status in ('draft','pending_review','approved','rejected','delivered')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text
);
create table public.skill_mastery (
  child_id uuid not null references public.children(id),
  skill_id text not null check (skill_id = any(basira_private.canonical_skill_ids())),
  mastery numeric not null check (mastery between 0 and 1),
  updated_at timestamptz not null default clock_timestamp(),
  source_session_id uuid not null references public.sessions(id),
  primary key (child_id, skill_id, updated_at)
);
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id),
  skill_ids text[] not null check (skill_ids <@ basira_private.canonical_skill_ids() and array_position(skill_ids,null) is null),
  item_ids text[] not null,
  review_status text not null default 'draft' check (review_status in ('draft','pending_review','approved','rejected','delivered')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz
);
create table public.parent_reports (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id),
  session_id uuid not null references public.sessions(id),
  content jsonb not null check (jsonb_typeof(content) = 'object' and content->>'language' = 'ar'),
  pdf_path text,
  review_status text not null default 'draft' check (review_status in ('draft','pending_review','approved','rejected','delivered')),
  approved_by uuid references public.profiles(id)
);
create table public.stage0_results (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id),
  session_id uuid not null references public.sessions(id),
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  examiner_id uuid not null references public.profiles(id),
  review_status text not null default 'draft' check (review_status in ('draft','pending_review','approved','rejected','delivered'))
);
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  table_name text not null,
  row_id text not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default clock_timestamp()
);

create index on public.children(guardian_id);
create index on public.children(specialist_id);
create index on public.consents(child_id, scope, expires_at);
create index on public.sessions(child_id);
create index on public.sessions(run_by);
create index on public.item_results(session_id);
create index on public.tap_results(session_id);
create index on public.fingerprints(session_id);
create index on public.skill_mastery(child_id, updated_at desc);
create index on public.plans(child_id);
create index on public.parent_reports(child_id);
create index on public.stage0_results(session_id);

-- Never authorize from user_metadata or a cached app_role claim.
create function basira_private.current_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;
create function basira_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(basira_private.current_role() = 'admin', false)
$$;
create function basira_private.is_database_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select session_user in ('postgres','supabase_admin')
    and current_setting('role',true) in ('none','postgres','supabase_admin')
$$;
create function basira_private.can_manage_child(child uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.children c where c.id = child and
    (basira_private.is_admin() or (basira_private.current_role() = 'specialist' and c.specialist_id = (select auth.uid()))))
$$;
create function basira_private.can_access_session(session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.sessions s where s.id = session and
    (basira_private.can_manage_child(s.child_id) or
      (basira_private.current_role() = 'examiner' and s.type = 'stage0' and s.run_by = (select auth.uid()))))
$$;
create function basira_private.can_read_child(child uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.children c where c.id = child and
    (basira_private.can_manage_child(c.id) or
      (basira_private.current_role() = 'guardian' and c.guardian_id = (select auth.uid())) or
      (basira_private.current_role() = 'examiner' and exists(
        select 1 from public.sessions s where s.child_id = c.id and s.type = 'stage0' and s.run_by = (select auth.uid())))))
$$;
create function basira_private.is_guardian(child uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select basira_private.current_role() = 'guardian' and exists(
    select 1 from public.children c where c.id = child and c.guardian_id = (select auth.uid()))
$$;
create function basira_private.has_consent(child uuid, session_type text, at_time timestamptz default now()) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.consents co join public.children c on c.id = co.child_id
    where c.id = child and co.guardian_id = c.guardian_id and co.specialist_id = c.specialist_id
      and co.scope = case when session_type = 'practice' then 'practice'
        when session_type in ('assessment','stage0','probe') then 'assessment' else null end
      and co.signed_at <= at_time and co.expires_at > at_time)
$$;
create function basira_private.can_write_result(session uuid, allow_examiner boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.sessions s where s.id = session and s.status <> 'abandoned'
    and basira_private.has_consent(s.child_id,s.type,now())
    and (basira_private.can_manage_child(s.child_id) or
      (allow_examiner and basira_private.current_role() = 'examiner' and s.type = 'stage0' and s.run_by = (select auth.uid()))))
$$;

create function basira_private.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The only user-controlled field copied is a display name. Role is always guardian.
  insert into public.profiles(id,role,display_name)
  values(new.id,'guardian',coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),'حساب جديد'));
  return new;
end $$;
-- The auth trigger inserts only the fixed guardian role; permit that exact path.
create function basira_private.guard_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.role <> 'guardian' and not basira_private.is_database_admin() and not basira_private.is_admin() then
      raise exception 'profile roles require trusted provisioning' using errcode='42501';
    end if;
  else
    if new.id is distinct from old.id then raise exception 'profile identity is immutable' using errcode='42501'; end if;
    if new.role is distinct from old.role and not basira_private.is_database_admin() and not basira_private.is_admin() then
      raise exception 'profile roles require trusted provisioning' using errcode='42501';
    end if;
    if new.role is distinct from old.role then
      if old.role='guardian' and exists(select 1 from public.children where guardian_id=old.id) then
        raise exception 'reassign child guardians before changing the guardian role' using errcode='23514';
      end if;
      if old.role='specialist' and exists(select 1 from public.children where specialist_id=old.id) then
        raise exception 'reassign children before changing the specialist role' using errcode='23514';
      end if;
      if old.role='examiner' and exists(select 1 from public.sessions where run_by=old.id and status='in_progress') then
        raise exception 'close active assigned sessions before changing the examiner role' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger guard_profile before insert or update on public.profiles for each row execute function basira_private.guard_profile();
create trigger basira_profile_created after insert on auth.users for each row execute function basira_private.on_auth_user_created();

create function basira_private.guard_child() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=new.guardian_id and role='guardian') or
     not exists(select 1 from public.profiles where id=new.specialist_id and role='specialist') then
    raise exception 'child requires a guardian and specialist of record' using errcode='23514';
  end if;
  if tg_op='UPDATE' then
    if new.id is distinct from old.id then raise exception 'child identity is immutable' using errcode='42501'; end if;
    if (new.guardian_id,new.specialist_id) is distinct from (old.guardian_id,old.specialist_id)
       and not basira_private.is_admin() and not basira_private.is_database_admin() then
      raise exception 'only admin may reassign child relationships' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_child before insert or update on public.children for each row execute function basira_private.guard_child();

create function basira_private.guard_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.children c where c.id=new.child_id and c.guardian_id=new.guardian_id and c.specialist_id=new.specialist_id) then
    raise exception 'consent must match current guardian and specialist' using errcode='23514';
  end if;
  if tg_op='INSERT' then
    if new.signed_at > statement_timestamp() then raise exception 'consent signature cannot be in the future' using errcode='23514'; end if;
    if not basira_private.is_database_admin() and not basira_private.is_guardian(new.child_id) then
      raise exception 'only the recorded guardian can sign consent' using errcode='42501';
    end if;
  else
    if (to_jsonb(new)-'expires_at') is distinct from (to_jsonb(old)-'expires_at') or new.expires_at > old.expires_at then
      raise exception 'consent evidence is immutable; only shortening expiry is permitted' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_consent before insert or update on public.consents for each row execute function basira_private.guard_consent();

create function basira_private.guard_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare supervisor_role text;
begin
  if tg_op='INSERT' then
    new.started_at := statement_timestamp();
    if new.status <> 'in_progress' or new.ended_at is not null then raise exception 'session must start in progress' using errcode='23514'; end if;
    if not basira_private.can_manage_child(new.child_id) then raise exception 'specialist assignment required to start session' using errcode='42501'; end if;
    select role into supervisor_role from public.profiles where id=new.run_by;
    if supervisor_role='specialist' then
      if not exists(select 1 from public.children where id=new.child_id and specialist_id=new.run_by) then raise exception 'supervisor must be specialist of record' using errcode='42501'; end if;
    elsif supervisor_role='examiner' then
      if new.type <> 'stage0' then raise exception 'examiner assignment is Stage 0 only' using errcode='42501'; end if;
    else
      raise exception 'supervisor must be specialist or examiner' using errcode='42501';
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
create trigger guard_session before insert or update on public.sessions for each row execute function basira_private.guard_session();

create function basira_private.guard_result() returns trigger
language plpgsql security definer set search_path = '' as $$
declare session_row public.sessions;
begin
  if tg_op='UPDATE' then
    if (new.id,new.session_id,new.item_id) is distinct from (old.id,old.session_id,old.item_id) then raise exception 'result identity is immutable' using errcode='42501'; end if;
    -- Audio cleanup may only clear the pointer after deleting the underlying object.
    if current_setting('role',true)='service_role' and tg_table_name='item_results'
       and new.audio_path is null and old.audio_path is not null
       and (to_jsonb(new)-'audio_path')=(to_jsonb(old)-'audio_path') then return new; end if;
    raise exception 'recorded results are immutable' using errcode='42501';
  end if;
  if not basira_private.can_write_result(new.session_id) then raise exception 'result requires assigned specialist and valid consent' using errcode='42501'; end if;
  if tg_table_name='item_results' then
    select * into session_row from public.sessions where id=new.session_id;
    new.audio_expires_at := session_row.started_at + interval '30 days';
    if new.audio_path is not null and new.audio_path <> 'audio/'||session_row.child_id||'/'||new.session_id||'/'||new.item_id||'.wav' then
      raise exception 'audio path must match child/session/item' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger guard_item_result before insert or update on public.item_results for each row execute function basira_private.guard_result();
create trigger guard_tap_result before insert or update on public.tap_results for each row execute function basira_private.guard_result();

create function basira_private.reject_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'append-only data cannot be changed' using errcode='42501'; end $$;
create trigger immutable_mastery before update or delete or truncate on public.skill_mastery for each statement execute function basira_private.reject_mutation();
create trigger immutable_audit before update or delete or truncate on public.audit_log for each statement execute function basira_private.reject_mutation();
create function basira_private.guard_mastery() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.sessions where id=new.source_session_id and child_id=new.child_id)
     or not basira_private.can_manage_child(new.child_id) then raise exception 'mastery requires matching specialist session' using errcode='42501'; end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger guard_mastery before insert on public.skill_mastery for each row execute function basira_private.guard_mastery();

create function basira_private.guard_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare child uuid; actor uuid := auth.uid(); changed_status boolean;
begin
  if tg_table_name='fingerprints' then
    select child_id into child from public.sessions where id=new.session_id;
  else child := new.child_id; end if;
  if child is null then raise exception 'review requires a valid child/session' using errcode='23514'; end if;
  if tg_table_name in ('parent_reports','stage0_results') then
    if not exists(select 1 from public.sessions s where s.id=new.session_id and s.child_id=new.child_id) then
      raise exception 'review child/session mismatch' using errcode='23514';
    end if;
  end if;
  if tg_table_name='stage0_results' then
    if not exists(select 1 from public.sessions s join public.profiles p on p.id=s.run_by where s.id=new.session_id and s.type='stage0' and p.role='examiner' and s.run_by=new.examiner_id) then
      raise exception 'Stage 0 result must match assigned examiner' using errcode='23514';
    end if;
  end if;
  if tg_op='INSERT' then
    if new.review_status not in ('draft','pending_review') then raise exception 'reviewed rows cannot be inserted directly' using errcode='42501'; end if;
    if tg_table_name='fingerprints' then new.reviewed_by := null; new.reviewed_at := null;
    elsif tg_table_name='plans' then new.approved_by := null; new.approved_at := null;
    elsif tg_table_name='parent_reports' then new.approved_by := null; end if;
    return new;
  end if;
  if tg_table_name='fingerprints' then
    if (new.id,new.session_id) is distinct from (old.id,old.session_id) then raise exception 'review identity is immutable' using errcode='42501'; end if;
    if new.response is distinct from old.response then raise exception 'original scorer response is immutable' using errcode='42501'; end if;
  else
    if (new.id,new.child_id) is distinct from (old.id,old.child_id) then raise exception 'review identity is immutable' using errcode='42501'; end if;
    if tg_table_name in ('parent_reports','stage0_results') then
      if new.session_id is distinct from old.session_id then raise exception 'review session is immutable' using errcode='42501'; end if;
    end if;
  end if;
  if tg_table_name='stage0_results' then
    if new.examiner_id is distinct from old.examiner_id then raise exception 'examiner attribution is immutable' using errcode='42501'; end if;
    if (new.request,new.response) is distinct from (old.request,old.response) then raise exception 'original scorer payload is immutable' using errcode='42501'; end if;
  end if;
  changed_status := new.review_status is distinct from old.review_status;
  if old.review_status in ('approved','delivered','rejected') and (to_jsonb(new)-'review_status') is distinct from (to_jsonb(old)-'review_status') then
    raise exception 'approved or terminal content is immutable; create a new draft' using errcode='42501';
  end if;
  if changed_status then
    if not ((old.review_status='draft' and new.review_status='pending_review') or
      (old.review_status='pending_review' and new.review_status in ('approved','rejected')) or
      (old.review_status='approved' and new.review_status='delivered')) then
      raise exception 'invalid approval transition' using errcode='23514';
    end if;
    if new.review_status in ('approved','rejected','delivered') and not basira_private.can_manage_child(child) then
      raise exception 'only specialist of record or admin may review' using errcode='42501';
    end if;
    if new.review_status='pending_review' then
      if tg_table_name='fingerprints' then new.reviewed_by := null; new.reviewed_at := null;
      elsif tg_table_name='plans' then new.approved_by := null; new.approved_at := null;
      elsif tg_table_name='parent_reports' then new.approved_by := null; end if;
    end if;
    if new.review_status in ('approved','rejected') then
      if tg_table_name='fingerprints' then new.reviewed_by := actor; new.reviewed_at := statement_timestamp();
      elsif tg_table_name='plans' then new.approved_by := case when new.review_status='approved' then actor else null end; new.approved_at := case when new.review_status='approved' then statement_timestamp() else null end;
      elsif tg_table_name='parent_reports' then new.approved_by := case when new.review_status='approved' then actor else null end; end if;
    end if;
  elsif tg_table_name='fingerprints' then
    if (new.reviewed_by,new.reviewed_at) is distinct from (old.reviewed_by,old.reviewed_at) then raise exception 'review attribution is server controlled' using errcode='42501'; end if;
  elsif tg_table_name='plans' then
    if (new.approved_by,new.approved_at) is distinct from (old.approved_by,old.approved_at) then raise exception 'approval attribution is server controlled' using errcode='42501'; end if;
  elsif tg_table_name='parent_reports' then
    if new.approved_by is distinct from old.approved_by then raise exception 'approval attribution is server controlled' using errcode='42501'; end if;
  end if;
  return new;
end $$;
create trigger guard_fingerprint_review before insert or update on public.fingerprints for each row execute function basira_private.guard_review();
create trigger guard_plan_review before insert or update on public.plans for each row execute function basira_private.guard_review();
create trigger guard_parent_report_review before insert or update on public.parent_reports for each row execute function basira_private.guard_review();
create trigger guard_stage0_review before insert or update on public.stage0_results for each row execute function basira_private.guard_review();

-- Parent-report JSON is family-safe only if it uses exactly the shared schema's fields.
create function basira_private.guard_parent_content() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not extensions.jsonb_matches_schema(basira_private.parent_report_schema(),new.content) then
    raise exception 'parent report must match the canonical family-safe Arabic contract' using errcode='23514';
  end if;
  if new.pdf_path is not null and new.pdf_path <> 'reports/'||new.child_id||'/'||new.id||'.pdf' then raise exception 'PDF path must match child/report' using errcode='23514'; end if;
  return new;
end $$;
create trigger guard_parent_content before insert or update on public.parent_reports for each row execute function basira_private.guard_parent_content();

create function basira_private.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare previous jsonb; following jsonb; row_key text; actor uuid;
begin
  if tg_op <> 'INSERT' then previous := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then following := to_jsonb(new); end if;
  row_key := coalesce(following->>'id',previous->>'id',(following->>'child_id')||':'||(following->>'skill_id')||':'||(following->>'updated_at'));
  actor := auth.uid();
  if not exists(select 1 from public.profiles where id=actor) then actor := null; end if;
  insert into public.audit_log(actor_id,action,table_name,row_id,before,after)
    values(actor,tg_op,tg_table_name,row_key,previous,following);
  return coalesce(new,old);
end $$;
do $$ declare t text; begin
  foreach t in array array['profiles','children','consents','sessions','item_results','tap_results','fingerprints','skill_mastery','plans','parent_reports','stage0_results'] loop
    execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function basira_private.write_audit()',t);
  end loop;
end $$;

-- Hook is callable only by Auth. Preserve all existing required claims.
create function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare profile_role text; claims jsonb;
begin
  select role into profile_role from public.profiles where id=(event->>'user_id')::uuid;
  if profile_role is null then raise exception 'profile required before issuing token'; end if;
  claims := event->'claims';
  claims := jsonb_set(claims,'{app_role}',to_jsonb(profile_role),true);
  return jsonb_set(event,'{claims}',claims,true);
end $$;
revoke all on function public.custom_access_token_hook(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Explicit grants; no user may insert audit records, delete reviewed data, or truncate.
do $$ declare t text; begin
  foreach t in array array['profiles','children','consents','sessions','item_results','tap_results','fingerprints','skill_mastery','plans','parent_reports','stage0_results','audit_log'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;
grant update(display_name,role) on public.profiles to authenticated;
grant insert,update on public.children,public.consents,public.sessions,public.fingerprints,public.plans,public.parent_reports,public.stage0_results to authenticated;
grant insert on public.item_results,public.tap_results,public.skill_mastery to authenticated;

create policy profile_read on public.profiles for select to authenticated using (id=auth.uid() or basira_private.is_admin());
create policy profile_update on public.profiles for update to authenticated using (id=auth.uid() or basira_private.is_admin()) with check (id=auth.uid() or basira_private.is_admin());
create policy child_read on public.children for select to authenticated using (basira_private.can_read_child(id));
create policy child_insert on public.children for insert to authenticated with check (basira_private.is_admin() or (basira_private.current_role()='specialist' and specialist_id=auth.uid()));
create policy child_update on public.children for update to authenticated using (basira_private.can_manage_child(id)) with check (basira_private.can_manage_child(id));
create policy consent_read on public.consents for select to authenticated using (basira_private.is_guardian(child_id) or basira_private.can_manage_child(child_id));
create policy consent_insert on public.consents for insert to authenticated with check (basira_private.is_guardian(child_id));
create policy consent_shorten on public.consents for update to authenticated using (basira_private.is_guardian(child_id)) with check (basira_private.is_guardian(child_id));
create policy session_read on public.sessions for select to authenticated using (basira_private.can_access_session(id));
create policy session_insert on public.sessions for insert to authenticated with check (basira_private.can_manage_child(child_id));
create policy session_update on public.sessions for update to authenticated using (basira_private.can_access_session(id)) with check (basira_private.can_access_session(id));
create policy item_read on public.item_results for select to authenticated using (exists(select 1 from public.sessions s where s.id=session_id and basira_private.can_manage_child(s.child_id)));
create policy item_insert on public.item_results for insert to authenticated with check (basira_private.can_write_result(session_id));
create policy tap_read on public.tap_results for select to authenticated using (exists(select 1 from public.sessions s where s.id=session_id and basira_private.can_manage_child(s.child_id)));
create policy tap_insert on public.tap_results for insert to authenticated with check (basira_private.can_write_result(session_id));
create policy fingerprint_read on public.fingerprints for select to authenticated using (exists(select 1 from public.sessions s where s.id=session_id and basira_private.can_manage_child(s.child_id)));
create policy fingerprint_insert on public.fingerprints for insert to authenticated with check (basira_private.can_write_result(session_id));
create policy fingerprint_update on public.fingerprints for update to authenticated using (exists(select 1 from public.sessions s where s.id=session_id and basira_private.can_manage_child(s.child_id))) with check (exists(select 1 from public.sessions s where s.id=session_id and basira_private.can_manage_child(s.child_id)));
create policy mastery_read on public.skill_mastery for select to authenticated using (basira_private.can_manage_child(child_id));
create policy mastery_insert on public.skill_mastery for insert to authenticated with check (basira_private.can_manage_child(child_id));
create policy plan_read on public.plans for select to authenticated using (basira_private.can_manage_child(child_id) or (basira_private.is_guardian(child_id) and review_status in ('approved','delivered')));
create policy plan_insert on public.plans for insert to authenticated with check (basira_private.can_manage_child(child_id));
create policy plan_update on public.plans for update to authenticated using (basira_private.can_manage_child(child_id)) with check (basira_private.can_manage_child(child_id));
create policy report_read on public.parent_reports for select to authenticated using (basira_private.can_manage_child(child_id) or (basira_private.is_guardian(child_id) and review_status in ('approved','delivered')));
create policy report_insert on public.parent_reports for insert to authenticated with check (basira_private.can_manage_child(child_id));
create policy report_update on public.parent_reports for update to authenticated using (basira_private.can_manage_child(child_id)) with check (basira_private.can_manage_child(child_id));
create policy stage0_read on public.stage0_results for select to authenticated using (basira_private.can_access_session(session_id));
create policy stage0_insert on public.stage0_results for insert to authenticated with check (basira_private.can_write_result(session_id,true));
create policy stage0_update on public.stage0_results for update to authenticated using (basira_private.can_access_session(session_id)) with check (basira_private.can_access_session(session_id));
create policy audit_read on public.audit_log for select to authenticated using (basira_private.is_admin());

-- B7 must use this narrow path for a supervised child's practice selection.
-- A specialist's review access to draft rows is deliberately not the child read path.
create function public.approved_practice_plan(p_child_id uuid)
returns table(plan_id uuid, skill_ids text[], item_ids text[])
language sql stable security invoker set search_path = '' as $$
  select p.id,p.skill_ids,p.item_ids from public.plans p
  where p.child_id=p_child_id and p.review_status='approved'
    and basira_private.can_manage_child(p.child_id)
  order by p.approved_at desc,p.id limit 1
$$;
revoke all on function public.approved_practice_plan(uuid) from public,anon;
grant execute on function public.approved_practice_plan(uuid) to authenticated;

-- Internal helpers are not Data API RPCs; grant only the policy entry points.
revoke all on all functions in schema basira_private from public,anon,authenticated;
grant execute on function basira_private.current_role(),basira_private.is_admin(),basira_private.can_manage_child(uuid),basira_private.can_access_session(uuid),basira_private.can_read_child(uuid),basira_private.is_guardian(uuid),basira_private.has_consent(uuid,text,timestamptz),basira_private.can_write_result(uuid,boolean),basira_private.canonical_skill_ids(),basira_private.canonical_dialect_ids() to authenticated;
