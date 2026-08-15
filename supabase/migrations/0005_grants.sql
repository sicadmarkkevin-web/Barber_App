-- 0005_grants.sql
-- Tables created via the SQL Editor (as this project's migrations do) do NOT get
-- Supabase's automatic anon/authenticated GRANTs the way tables created through
-- the Studio UI do. Without this, every query fails with
-- "permission denied for table X" *before* RLS is ever evaluated — RLS policies
-- only decide which ROWS a role can see once that role already has base
-- privileges on the TABLE. This does not weaken security: RLS policies from
-- 0002_rls_policies.sql still apply on top of these grants and are what
-- actually restrict which rows anon/authenticated can read or write.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- So tables created by *future* migrations get the same grants automatically,
-- without needing to remember to repeat this file each time.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
