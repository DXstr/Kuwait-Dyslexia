-- INSERT ... RETURNING evaluates SELECT policy before a STABLE helper can
-- re-query the just-inserted session. Use this row's immutable assignment fields
-- directly; retain exactly the existing specialist/admin/Stage 0 examiner scope.
drop policy session_read on public.sessions;
create policy session_read on public.sessions for select to authenticated
using (
  basira_private.can_manage_child(child_id)
  or (
    basira_private.current_role() = 'examiner'
    and type = 'stage0'
    and run_by = (select auth.uid())
  )
);
