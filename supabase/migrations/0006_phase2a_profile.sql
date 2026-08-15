-- 0006_phase2a_profile.sql
-- Additive only — does not modify 0001-0005.
--
-- Inspected the existing `barbers` table first: shop_name, tagline, bio,
-- profile_image_url, phone, facebook_url, instagram_url, tiktok_url already
-- exist from Phase 1 and are reused as-is (tagline is being used as the
-- "short bio" field is actually `bio` itself — no renaming needed, both
-- already exist). The only two fields Phase 2A's form asks for that the
-- schema doesn't have yet are Messenger and Website.
--
-- Note on filename: the brief asked for 0005_phase2a_profile.sql, but 0005 is
-- already taken — it's the grants migration you ran to fix the "permission
-- denied for table barbers" issue. Using 0006 instead so nothing gets
-- overwritten.

alter table barbers add column if not exists messenger_url text;
alter table barbers add column if not exists website_url text;

-- No RLS changes: RLS is row-level, not column-level, so the existing
-- "barbers: owner update" / "barbers: public select" policies from
-- 0002_rls_policies.sql already cover these two new columns automatically.
-- No new grants needed either — 0005_grants.sql's blanket grant on
-- "all tables in schema public" already applies here.
