-- FIX: delete_group raised "group not found" for groups that plainly exist.
--
-- Root cause: the old body called app_group_id() INLINE in the DELETE's WHERE
-- clause: `delete from groups where id = app_group_id(p_code)`. When a function
-- that SELECTs from `groups` is evaluated inside a DELETE on that same `groups`
-- table (under RLS), its internal SELECT comes back empty, so app_group_id
-- wrongly raises 'group not found'. app_group_id() on its own resolves fine.
--
-- Fix: resolve the id into a variable FIRST, then delete by that variable --
-- the exact pattern archive_settled() already uses (which is why it worked and
-- the old delete_group did not). Run this in the SQL editor of project
-- raparfpfnjhccngsohdi.

create or replace function delete_group(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_gid uuid := app_group_id(p_code);
begin
  delete from groups where id = v_gid;
end;
$$;

grant execute on function delete_group(text) to anon, authenticated;
