-- Submission readiness: one real, labelled demo child assigned to the actual
-- specialist and guardian Google accounts used for competition judging, so the
-- specialist login has something to select in ConsentWorkspace/Assessment.
-- No consent row is created here -- that must be a genuine action by the
-- signed-in guardian account through the product UI, never fabricated.
--
-- The referenced guardian/specialist profiles only exist in the hosted
-- production database (they are real accounts, not seed data), so this insert
-- is a no-op on any fresh database -- such as CI's local Supabase stack or a
-- new contributor's local stack -- where those profiles are absent.

begin;

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
select
  '00000000-0000-4000-b000-000000000001',
  'جود (ملف تجريبي)',
  3,
  '2018-03',
  'kw',
  'cfb0a8c3-360b-4d14-ae17-715691d3fd36', -- guardian demo account
  '2494dc60-e825-4777-a88f-f1c1de662b89', -- specialist demo account
  true
where exists (select 1 from public.profiles where id = 'cfb0a8c3-360b-4d14-ae17-715691d3fd36' and role = 'guardian')
  and exists (select 1 from public.profiles where id = '2494dc60-e825-4777-a88f-f1c1de662b89' and role = 'specialist')
on conflict (id) do nothing;

commit;
