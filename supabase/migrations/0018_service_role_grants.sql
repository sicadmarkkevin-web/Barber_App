-- 0018_service_role_grants.sql
-- Fixes: "permission denied for table bookings" (Postgres code 42501) from
-- the create-checkout Edge Function.
--
-- Root cause: 0005_grants.sql granted SELECT/INSERT/UPDATE/DELETE to
-- `anon, authenticated` (needed because every table in this project was
-- created via raw SQL migrations, not Supabase Studio's table editor, which
-- is the only way tables get those grants automatically) — but never
-- included `service_role`. service_role has BYPASSRLS, which skips RLS
-- POLICY evaluation, but that is a separate, later check from the base
-- table-level GRANT privilege check this error is actually about. Every
-- Edge Function using the service-role key to query Postgres directly
-- (create-checkout here; the same will apply to paymongo-webhook,
-- connect-paymongo, disconnect-paymongo on their own tables once exercised)
-- hits this same wall until service_role is granted explicitly, same as
-- anon/authenticated already were.
--
-- Scope: exactly the tables and operations create-checkout uses today —
-- `bookings` (select + update), `barbers` (select), `services` (select, via
-- the embedded `services ( name )` join in its bookings query, which
-- PostgREST resolves by needing SELECT on the joined table too). Not a
-- blanket grant, and not touching anon/authenticated (already correct).
-- RLS itself is completely untouched — this only affects the privilege
-- check that happens before RLS is ever evaluated, exactly like 0005 did
-- for anon/authenticated.

grant select, update on bookings to service_role;
grant select on barbers to service_role;
grant select on services to service_role;