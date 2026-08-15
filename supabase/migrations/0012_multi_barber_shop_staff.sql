-- 0012_multi_barber_shop_staff.sql
-- Phase 1 of "solo vs shop" support: schema + owner-side staff management only.
-- Additive only — does not modify 0001-0011. The customer-facing "pick your
-- barber" booking step (wiring bookings.staff_id + availability into
-- create_booking/get_available_slots) is deliberately a separate phase.
--
-- Design:
--  - barbers.account_type distinguishes a solo page from a shop page. Solo
--    accounts keep working exactly as before — nothing about their data model
--    changes; they simply never get rows in barber_staff.
--  - barber_staff: one row per staff member at a shop. No login of their own
--    — the shop owner (barbers.owner_profile_id) manages them, same as every
--    other owner-write / public-read table in this schema.
--  - staff_business_hours mirrors business_hours' shape exactly but is keyed
--    by staff_id instead of barber_id, so each staff member can have
--    independent hours. business_hours itself is untouched and keeps serving
--    solo accounts (and, until Phase 2 wires it up, is also still the
--    fallback shop-level hours a shop account's public page/settings use).
--  - bookings.staff_id is added now (nullable, on delete set null) so it
--    exists for Phase 2 to build on, but nothing in this migration requires
--    or enforces it yet — existing solo booking flow is unaffected.

-- ---------------------------------------------------------------------------
-- barbers.account_type
-- ---------------------------------------------------------------------------
alter table barbers
  add column if not exists account_type text not null default 'solo'
  check (account_type in ('solo', 'shop'));

-- ---------------------------------------------------------------------------
-- barber_staff: one row per staff member working at a shop account.
-- ---------------------------------------------------------------------------
create table if not exists barber_staff (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references barbers(id) on delete cascade,
  name text not null,
  photo_url text,
  bio text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists barber_staff_barber_id_idx on barber_staff(barber_id);

-- ---------------------------------------------------------------------------
-- staff_business_hours: same shape as business_hours, keyed by staff_id.
-- ---------------------------------------------------------------------------
create table if not exists staff_business_hours (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references barber_staff(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  is_closed boolean not null default false,
  open_time time not null default '09:00',
  close_time time not null default '18:00',
  unique (staff_id, day_of_week)
);

-- ---------------------------------------------------------------------------
-- bookings.staff_id — added now, wired up in Phase 2.
-- ---------------------------------------------------------------------------
alter table bookings
  add column if not exists staff_id uuid references barber_staff(id) on delete set null;
create index if not exists bookings_staff_id_idx on bookings(staff_id);

-- ---------------------------------------------------------------------------
-- RLS — same shape as services/hair_styles/business_hours in 0002: public
-- read (the public page will need to list staff to pick from in Phase 2),
-- owner-only write. Grants come from 0005's `alter default privileges`, so
-- no separate grant statement is needed here.
-- ---------------------------------------------------------------------------
alter table barber_staff enable row level security;
alter table staff_business_hours enable row level security;

create policy "barber_staff: public select" on barber_staff for select using (true);
create policy "barber_staff: owner write" on barber_staff for all using (
  exists (select 1 from barbers b where b.id = barber_staff.barber_id and b.owner_profile_id = auth.uid())
) with check (
  exists (select 1 from barbers b where b.id = barber_staff.barber_id and b.owner_profile_id = auth.uid())
);

create policy "staff_business_hours: public select" on staff_business_hours for select using (true);
create policy "staff_business_hours: owner write" on staff_business_hours for all using (
  exists (
    select 1 from barber_staff s
    join barbers b on b.id = s.barber_id
    where s.id = staff_business_hours.staff_id and b.owner_profile_id = auth.uid()
  )
) with check (
  exists (
    select 1 from barber_staff s
    join barbers b on b.id = s.barber_id
    where s.id = staff_business_hours.staff_id and b.owner_profile_id = auth.uid()
  )
);