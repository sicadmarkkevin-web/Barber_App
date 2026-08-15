-- 0015_customer_location.sql
-- Adds: barber business-location coordinates, a home-service toggle, and a
-- per-booking location snapshot (shop or customer home address).
-- Additive only — does not modify 0001-0014.
--
-- Inspected first (see chat): `barbers.location` already exists as a free-text
-- address (added in 0001) but was never actually exposed in the profile
-- editor UI, and has no coordinates. `bookings.notes` already exists and is
-- already accepted/stored by create_booking (0003/0008/0013) — it just isn't
-- wired up on the frontend yet. Neither of those needed a schema change.
-- Genuinely missing: barber coordinates, a home-service flag, and a place to
-- snapshot the appointment's actual location on the booking itself.
--
-- No new RLS policies: `bookings` RLS ("bookings: select barber or customer"
-- from 0002) already scopes every row to the owning barber or that booking's
-- own customer — a customer's home address, stored as plain columns on
-- `bookings`, automatically inherits that same row-level privacy. Same for
-- `barbers` — its existing public-select / owner-write policies already cover
-- the two new columns (RLS is row-level, not column-level).

-- ---------------------------------------------------------------------------
-- 1. barbers: business-location coordinates + a home-service toggle.
-- ---------------------------------------------------------------------------
alter table barbers add column if not exists location_lat double precision;
alter table barbers add column if not exists location_lng double precision;

-- home_service_enabled lives in the existing booking_settings jsonb (same
-- place as allow_style_selection/manual_confirmation/deposit_*) rather than
-- as its own column — jsonb needs no migration to add a key, and this keeps
-- the same pattern the rest of that settings screen already uses. Missing
-- key defaults to false via coalesce, both here and in create_booking below.

-- ---------------------------------------------------------------------------
-- 2. bookings: location snapshot, captured at booking time so it survives
-- the barber later changing their shop address (see chat — this was an
-- explicit requirement: old bookings must keep showing the address that was
-- actually true when the appointment was made).
-- ---------------------------------------------------------------------------
alter table bookings add column if not exists location_type text not null default 'shop'
  check (location_type in ('shop', 'home'));
alter table bookings add column if not exists location_address text;
alter table bookings add column if not exists location_lat double precision;
alter table bookings add column if not exists location_lng double precision;

-- ---------------------------------------------------------------------------
-- 3. create_booking gains location params. Signature is changing, so (same
-- reasoning as 0013) the old signature is dropped first rather than relying
-- on CREATE OR REPLACE, which would otherwise leave both overloads in place.
-- Every existing check (service/style ownership, staff validation, hours,
-- blocked dates, conflict check) is byte-for-byte the same as 0013's version.
-- ---------------------------------------------------------------------------
drop function if exists create_booking(uuid, uuid, date, time, text, text, text, uuid, text, text, uuid);

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
  p_notes text default null,
  p_staff_id uuid default null,
  p_location_type text default 'shop',
  p_location_address text default null,
  p_location_lat double precision default null,
  p_location_lng double precision default null
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barber barbers%rowtype;
  v_service services%rowtype;
  v_hours business_hours%rowtype;
  v_staff_hours staff_business_hours%rowtype;
  v_day_of_week int;
  v_end_time time;
  v_customer_id uuid;
  v_caller_profile_id uuid := auth.uid();
  v_deposit_required boolean;
  v_conflict_count int;
  v_booking bookings%rowtype;
  v_location_address text;
  v_location_lat double precision;
  v_location_lng double precision;
begin
  perform pg_advisory_xact_lock(hashtext(p_barber_id::text || p_date::text));

  select * into v_barber from barbers where id = p_barber_id;

  select * into v_service from services
    where id = p_service_id and barber_id = p_barber_id and active = true;
  if not found then
    raise exception 'That service is not available.';
  end if;

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

  if p_staff_id is not null then
    if not exists (
      select 1 from barber_staff s where s.id = p_staff_id and s.barber_id = p_barber_id and s.active = true
    ) then
      raise exception 'That staff member is not available.';
    end if;
  elsif v_barber.account_type = 'shop' and exists (
    select 1 from barber_staff s where s.barber_id = p_barber_id and s.active = true
  ) then
    raise exception 'Please select a barber.';
  end if;

  -- Location: validate + snapshot. For "shop", the barber's OWN current
  -- address/coordinates are always used server-side — client-supplied
  -- address/lat/lng are ignored for this type, so a customer can never claim
  -- a shop appointment happens somewhere other than the real shop. For
  -- "home", the barber must actually have home service enabled, and an
  -- address is required (coordinates are optional — geolocation may have
  -- been denied, and the booking must still work per the booking-flow spec).
  if p_location_type not in ('shop', 'home') then
    raise exception 'Invalid appointment location.';
  end if;

  if p_location_type = 'home' then
    if not coalesce((v_barber.booking_settings->>'home_service_enabled')::boolean, false) then
      raise exception 'This barber does not offer home service.';
    end if;
    if p_location_address is null or trim(p_location_address) = '' then
      raise exception 'Please provide a location for home service.';
    end if;
    v_location_address := trim(p_location_address);
    v_location_lat := p_location_lat;
    v_location_lng := p_location_lng;
  else
    v_location_address := v_barber.location;
    v_location_lat := v_barber.location_lat;
    v_location_lng := v_barber.location_lng;
  end if;

  v_end_time := p_start_time + make_interval(mins => v_service.duration_minutes);
  v_day_of_week := extract(dow from p_date)::int;

  if p_staff_id is not null then
    select * into v_staff_hours from staff_business_hours
      where staff_id = p_staff_id and day_of_week = v_day_of_week;
    if not found or v_staff_hours.is_closed then
      raise exception 'That barber is not available that day.';
    end if;
    if p_start_time < v_staff_hours.open_time or v_end_time > v_staff_hours.close_time then
      raise exception 'That time is outside that barber''s hours.';
    end if;
  else
    select * into v_hours from business_hours
      where barber_id = p_barber_id and day_of_week = v_day_of_week;
    if not found or v_hours.is_closed then
      raise exception 'The shop is closed that day.';
    end if;
    if p_start_time < v_hours.open_time or v_end_time > v_hours.close_time then
      raise exception 'That time is outside business hours.';
    end if;
  end if;

  if exists (select 1 from blocked_dates where barber_id = p_barber_id and date = p_date) then
    raise exception 'That date is not available for booking.';
  end if;

  select count(*) into v_conflict_count from bookings
    where barber_id = p_barber_id
      and coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(p_staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
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
    duration_minutes, status, deposit_status, reference_photo_url, notes, staff_id,
    location_type, location_address, location_lat, location_lng
  ) values (
    p_barber_id, v_customer_id, p_service_id, p_hair_style_id, p_date, p_start_time,
    v_service.duration_minutes, 'pending',
    case when v_deposit_required then 'pending' else 'not_required' end,
    p_reference_photo_url, p_notes, p_staff_id,
    p_location_type, v_location_address, v_location_lat, v_location_lng
  )
  returning * into v_booking;

  return v_booking;
end;
$$;

grant execute on function create_booking to authenticated, anon;