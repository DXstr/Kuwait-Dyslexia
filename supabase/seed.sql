-- Basira local-only demo seed.
-- This file is loaded by `supabase db reset --local`; it is not hosted provisioning.
-- All identities use reserved .invalid addresses, have no password, and cannot sign in.
-- No child scores, audio, sessions, consents, or real personal data belong in this seed.

begin;

-- The profile trigger creates a guardian profile for every new auth user.  The
-- role/display-name updates below are an explicit database-admin seed step; they
-- do not trust user metadata or a client JWT claim.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-a000-000000000001',
    'authenticated', 'authenticated', 'admin@example.invalid', '', null,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-a000-000000000002',
    'authenticated', 'authenticated', 'specialist@example.invalid', '', null,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-a000-000000000003',
    'authenticated', 'authenticated', 'examiner@example.invalid', '', null,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-a000-000000000004',
    'authenticated', 'authenticated', 'guardian@example.invalid', '', null,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-a000-000000000005',
    'authenticated', 'authenticated', 'other-specialist@example.invalid', '', null,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-a000-000000000006',
    'authenticated', 'authenticated', 'other-guardian@example.invalid', '', null,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  )
on conflict (id) do nothing;

reset role;

-- Seed roles only as the database administrator. Every display name is visibly
-- labelled as a demo profile, including non-child accounts.
update public.profiles as p
set role = v.role,
    display_name = v.display_name
from (
  values
    ('00000000-0000-4000-a000-000000000001'::uuid, 'admin'::text, 'مدير (ملف تجريبي)'::text),
    ('00000000-0000-4000-a000-000000000002'::uuid, 'specialist'::text, 'أخصائي (ملف تجريبي)'::text),
    ('00000000-0000-4000-a000-000000000003'::uuid, 'examiner'::text, 'فاحص (ملف تجريبي)'::text),
    ('00000000-0000-4000-a000-000000000004'::uuid, 'guardian'::text, 'ولي أمر (ملف تجريبي)'::text),
    ('00000000-0000-4000-a000-000000000005'::uuid, 'specialist'::text, 'أخصائي آخر (ملف تجريبي)'::text),
    ('00000000-0000-4000-a000-000000000006'::uuid, 'guardian'::text, 'ولي أمر آخر (ملف تجريبي)'::text)
) as v(id, role, display_name)
where p.id = v.id;

-- Stable demo children: 010 belongs to guardian 004/specialist 002;
-- 011 belongs to guardian 006/specialist 005.  No consent is fabricated here.
insert into public.children (
  id,
  first_name,
  grade,
  birth_month,
  dialect_lexicon_id,
  guardian_id,
  specialist_id,
  is_demo
)
values
  (
    '00000000-0000-4000-a000-000000000010',
    'ليان (ملف تجريبي)',
    2,
    '2017-02',
    'kw',
    '00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-a000-000000000002',
    true
  ),
  (
    '00000000-0000-4000-a000-000000000011',
    'سالم (ملف تجريبي)',
    4,
    '2015-09',
    'msa',
    '00000000-0000-4000-a000-000000000006',
    '00000000-0000-4000-a000-000000000005',
    true
  )
on conflict (id) do nothing;

commit;
