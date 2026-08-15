-- 0008_phase3a_booking_foundation.sql
-- Additive only — does not modify 0001-0007. See chat for the full inspection
-- writeup this migration is based on. Summary of what changes and why:
--
-- 1. bookings.updated_at — the conceptual data model calls for it; wasn't
--    there. Auto-maintained by a trigger.
--
-- 2. Real double-booking constraint (defense-in-depth) — create_booking's
--    pg_advisory_xact_lock + overlap check is safe today because bookings has
--    no client-facing INSERT policy, so create_booking is the only way a row
--    gets written. This constraint makes that guarantee independent of any
--    code path, present or future.
--
-- 3. create_booking gains two checks it was missing:
--      - a submitted hair_style_id must belong to the same barber as the
--        booking (previously unchecked — a style ID from another barber
--        would have been silently accepted)
--      - if the barber's booking_settings.allow_style_selection is false,
--        a submitted hair_style_id is rejected
--    Signature and return type are unchanged; every other check (service
--    ownership, business hours, blocked dates, double-booking) is untouched.
--
-- 4. bookings RLS: the existing UPDATE policy (from 0002) lets either the
--    barber or the customer update ANY column of a booking, which is broader
--    than "allowed status transitions" — and nothing in the app uses this
--    yet, since no reschedule/cancel/confirm UI has been built. Replacing it
--    with barber-only UPDATE for now; customer-initiated changes (cancel,
--    reschedule) get their own narrowly-scoped mechanism once that flow is
--    actually designed, rather than leaving a blanket right unused and
--    unexercised. This is a tightening, not a weakening, of existing RLS.
--    (The comment in 0002 describing the old policy is now superseded by
--    this file — left as-is there per "don't modify old migrations.")

-- ---------------------------------------------------------------------------
-- 1. updated_at
-- ---------------------------------------------------------------------------
alter table bookings add column if not exists updated_at timestamptz not null default now();

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists bookings_set_updated_at on bookings;
create trigger bookings_set_updated_at
  before update on bookings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Real double-booking constraint. tsrange (not tstzrange) is deliberate —
-- date/start_time/duration are stored and treated as the barber's own local
-- wall-clock time throughout this app (see barbers.timezone), so this stays
-- consistent with the "no unnecessary UTC conversion" approach already used
-- everywhere else rather than introducing it only here.
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist;

alter table bookings add column if not exists time_range tsrange
  generated always as (
    tsrange(date + start_time, date + start_time + make_interval(mins => duration_minutes))
  ) stored;

alter table bookings drop constraint if exists bookings_no_overlap;
alter table bookings add constraint bookings_no_overlap
  exclude using gist (barber_id with =, time_range with &&)
  where (status <> 'cancelled');

-- ---------------------------------------------------------------------------
-- 3. create_booking: add style-ownership + allow_style_selection checks.
-- Everything else is byte-for-byte the same as 0003's version.
-- ---------------------------------------------------------------------------
create or replace function create_booking(
  p_barber_id uuid,
  p_service_id uuid,
  p_date date,
  p_start_time time,
  p_customer_name text,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_hair_style_id uuid default null,
  p_reference_photo_url text default null,
  p_notes text default null
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service services%rowtype;
  v_hours business_hours%rowtype;
  v_day_of_week int;
  v_end_time time;
  v_customer_id uuid;
  v_caller_profile_id uuid := auth.uid(); -- null for guest/anon bookings
  v_deposit_required boolean;
  v_conflict_count int;
  v_booking bookings%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_barber_id::text || p_date::text));

  select * into v_service from services
    where id = p_service_id and barber_id = p_barber_id and active = true;
  if not found then
    raise exception 'That service is not available.';
  end if;

  -- NEW: style must belong to this barber, and this barber must allow style
  -- selection at all, before we accept it.
  if p_hair_style_id is not null then
    if not exists (
      select 1 from hair_styles where id = p_hair_style_id and barber_id = p_barber_id
    ) then
      raise exception 'That style is not available for this barber.';
    end if;

    if not coalesce(
      (select (b.booking_settings->>'allow_style_selection')::boolean from barbers b where b.id = p_barber_id),
      true
    ) then
      raise exception 'This barber does not offer style selection for bookings.';
    end if;
  end if;

  v_end_time := p_start_time + make_interval(mins => v_service.duration_minutes);

  v_day_of_week := extract(dow from p_date)::int;
  select * into v_hours from business_hours
    where barber_id = p_barber_id and day_of_week = v_day_of_week;
  if not found or v_hours.is_closed then
    raise exception 'The shop is closed that day.';
  end if;
  if p_start_time < v_hours.open_time or v_end_time > v_hours.close_time then
    raise exception 'That time is outside business hours.';
  end if;

  if exists (select 1 from blocked_dates where barber_id = p_barber_id and date = p_date) then
    raise exception 'That date is not available for booking.';
  end if;

  select count(*) into v_conflict_count from bookings
    where barber_id = p_barber_id
      and date = p_date
      and status != 'cancelled'
      and start_time < v_end_time
      and (start_time + make_interval(mins => duration_minutes)) > p_start_time;
  if v_conflict_count > 0 then
    raise exception 'That time was just booked. Please pick another slot.';
  end if;

  if v_caller_profile_id is not null then
    select id into v_customer_id from customers where profile_id = v_caller_profile_id limit 1;
  end if;
  if v_customer_id is null then
    insert into customers (profile_id, name, phone, email)
    values (v_caller_profile_id, p_customer_name, p_customer_phone, p_customer_email)
    returning id into v_customer_id;
  end if;

  select coalesce((select b.booking_settings->>'deposit_required' from barbers b where b.id = p_barber_id)::boolean, false)
    into v_deposit_required;

  insert into bookings (
    barber_id, customer_id, service_id, hair_style_id, date, start_time,
    duration_minutes, status, deposit_status, reference_photo_url, notes
  ) values (
    p_barber_id, v_customer_id, p_service_id, p_hair_style_id, p_date, p_start_time,
    v_service.duration_minutes, 'pending',
    case when v_deposit_required then 'pending' else 'not_required' end,
    p_reference_photo_url, p_notes
  )
  returning * into v_booking;

  return v_booking;
end;
$$;

grant execute on function create_booking to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. Tighten bookings UPDATE to barber-only for now (see header note).
-- SELECT policy from 0002 is untouched — barber-or-customer read access is
-- still correct and unaffected by this.
-- ---------------------------------------------------------------------------
drop policy if exists "bookings: update barber or customer" on bookings;

create policy "bookings: barber update" on bookings for update using (
  exists (select 1 from barbers b where b.id = bookings.barber_id and b.owner_profile_id = auth.uid())
);

-- No new grants needed — 0005_grants.sql's blanket grant already covers
-- bookings and every column added here.
