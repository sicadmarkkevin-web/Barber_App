-- 0007_phase2c_styles.sql
-- Additive only — does not modify 0001-0006.
--
-- Inspected `hair_styles` first: name, description, image_url, category,
-- sort_order, and ownership via barber_id already exist from Phase 1 and are
-- reused as-is. Storage is also reused as-is — the `style-images` bucket and
-- its owner-write / public-read policies already exist from 0004_storage.sql
-- and already use the "{barber_id}/filename" path convention this phase
-- follows, so no storage migration is needed either.
--
-- The one thing missing: `icon`. The original single-file app let a barber
-- pick a themed icon (fade, taper, undercut, mohawk, flattop, hardpart, bald,
-- spiky, messy, fringe) for styles with no uploaded photo — reused here as
-- HairIcon.jsx. Nullable/optional per the brief ("icon can remain optional").

alter table hair_styles add column if not exists icon text;

-- No RLS changes: RLS is row-level, not column-level, so the existing
-- "hair_styles: owner write" / "hair_styles: public select" policies from
-- 0002_rls_policies.sql already cover this new column automatically. No new
-- grants needed either — 0005_grants.sql's blanket grant already applies.
