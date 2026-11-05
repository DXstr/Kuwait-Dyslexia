-- Usability fix: a specialist had no way to onboard a real guardian at all.
-- children.guardian_id must reference an existing guardian profile, but RLS
-- only lets a profile owner (or admin) read a profile row, so a specialist
-- could never discover a guardian's profile id to create a child for them --
-- every child so far required a hand-written migration. This adds a single,
-- narrow lookup: a specialist (or admin) may resolve a guardian's profile id
-- from their account email, and nothing else about that account. The actual
-- child insert still goes through the existing RLS-checked, guard_child()
-- validated public.children insert -- this migration grants no new write
-- access.

begin;

create function public.find_guardian_by_email(p_email text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if basira_private.current_role() not in ('specialist', 'admin') then
    raise exception 'only a specialist or admin may resolve a guardian by email' using errcode = '42501';
  end if;
  return (
    select p.id
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'guardian' and lower(u.email) = lower(btrim(p_email))
    limit 1
  );
end $$;

revoke all on function public.find_guardian_by_email(text) from public, anon;
grant execute on function public.find_guardian_by_email(text) to authenticated;

commit;
