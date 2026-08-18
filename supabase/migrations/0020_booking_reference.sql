-- 0020_booking_reference.sql
-- Professional Appointment Reference System, Phase 1. No QR codes, no
-- check-in, no PayMongo changes — exactly as scoped. Additive only — does
-- not modify 0001-0020 except create_booking, which gets one addition
-- (reference generation before insert); every existing check is
-- byte-for-byte the same as 0020's version.
--
-- Inspected first (see chat): bookings has no existing customer-facing
-- reference field. There IS an unrelated `payment_reference` column
-- (0016) — that's PayMongo's own checkout session id, a different concept
-- entirely; this migration adds a new, distinctly-named `booking_reference`
-- column rather than overloading that one.
--
-- The "same browser, second booking shows the first customer's info" bug
-- mentioned in the brief was a real, separate bug fixed in 0020 (customer
-- row reuse when a real login session existed) — already resolved. This
-- migration doesn't reopen that: the reference comes back on the same
-- `bookings` row create_booking already returns via `returning * into
-- v_booking`, so the frontend needs no new fetch, no new state, and can't
-- accidentally read a stale/previous booking's reference — it's already
-- reading the actual just-created row (see BookingFlow.jsx already storing
-- this in `createdBooking` state, added during the payments phase).

-- ---------------------------------------------------------------------------
-- 1. generate_booking_reference: collision-safe APT-XXXXXX generator.
-- 6 chars from a 36-character alphabet (A-Z0-9) is ~2.18 billion possible
-- values — the existence check + retry loop is a belt-and-suspenders
-- measure on top of that, and the UNIQUE constraint below is the final,
-- authoritative protection against a genuine collision.
-- ---------------------------------------------------------------------------
create or replace function generate_booking_reference()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  candidate text;
  i int;
  attempt int := 0;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(chars, (floor(random() * length(chars)) + 1)::int, 1);
    end loop;
    candidate := 'APT-' || candidate;

    exit when not exists (select 1 from bookings where booking_reference = candidate);

    attempt := attempt + 1;
    if attempt > 20 then
      raise exception 'Could not generate a unique booking reference.';
    end if;
  end loop;

  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. bookings.booking_reference — added nullable first so existing rows
-- aren't rejected, then backfilled, then locked down with NOT NULL + UNIQUE
-- once every row genuinely has one. Mirrors the exact phased approach
-- requested: add -> backfill -> unique -> require.
-- ---------------------------------------------------------------------------
alter table bookings add column if not exists booking_reference text;

do $$
declare
  r record;
begin
  for r in select id from bookings where booking_reference is null loop
    update bookings set booking_reference = generate_booking_reference() where id = r.id;
  end loop;
end $$;

alter table bookings alter column booking_reference set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_booking_reference_key') then
    alter table bookings add constraint bookings_booking_reference_key unique (booking_reference);
  end if;
end $$;

-- No RLS changes: this is just another column on a row already governed by
-- bookings' existing "select barber or customer" policy. The reference
-- reaches the customer through create_booking's own RETURNING clause (the
-- RPC response), not through a SELECT a customer would otherwise be unable
-- to make — exactly why no policy needs to change here.

-- ---------------------------------------------------------------------------
-- 3. create_booking: generates the reference and includes it in the
-- INSERT. Signature unchanged (no new parameter — generated purely
-- server-side, never client-supplied) — every check above the customer/
-- payment block is byte-for-byte identical to 0020's version.
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
  v_conflict_count int;
  v_booking bookings%rowtype;
  v_location_address text;
  v_location_lat double precision;
  v_location_lng double precision;
  v_deposit_type text;
  v_deposit_value numeric;
  v_deposit_amount numeric;
  v_payment_status text;
  v_booking_reference text;
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
    if v_customer_id is not null then
      update customers
        set name = p_customer_name,
            phone = coalesce(p_customer_phone, phone),
            email = coalesce(p_customer_email, email)
        where id = v_customer_id;
    end if;
  end if;
  if v_customer_id is null then
    insert into customers (profile_id, name, phone, email)
    values (v_caller_profile_id, p_customer_name, p_customer_phone, p_customer_email)
    returning id into v_customer_id;
  end if;

  v_deposit_type := coalesce(v_barber.booking_settings->>'deposit_type', 'none');
  v_deposit_amount := compute_deposit(
    v_service.price,
    v_deposit_type,
    (v_barber.booking_settings->>'deposit_percent')::numeric,
    (v_barber.booking_settings->>'deposit_amount')::numeric
  );
  v_deposit_value := case
    when v_deposit_type = 'percentage' then (v_barber.booking_settings->>'deposit_percent')::numeric
    when v_deposit_type = 'fixed' then (v_barber.booking_settings->>'deposit_amount')::numeric
    else null
  end;
  v_payment_status := case when v_deposit_amount > 0 then 'pending' else 'unpaid' end;

  -- NEW: generated fresh for this specific booking — never reused, never
  -- derived from any prior request or session.
  v_booking_reference := generate_booking_reference();

  insert into bookings (
    barber_id, customer_id, service_id, hair_style_id, date, start_time,
    duration_minutes, status, reference_photo_url, notes, staff_id,
    location_type, location_address, location_lat, location_lng,
    total_amount, deposit_type, deposit_value, deposit_amount, remaining_balance, payment_status,
    booking_reference
  ) values (
    p_barber_id, v_customer_id, p_service_id, p_hair_style_id, p_date, p_start_time,
    v_service.duration_minutes, 'pending',
    p_reference_photo_url, p_notes, p_staff_id,
    p_location_type, v_location_address, v_location_lat, v_location_lng,
    v_service.price, v_deposit_type, v_deposit_value, v_deposit_amount,
    v_service.price - v_deposit_amount, v_payment_status,
    v_booking_reference
  )
  returning * into v_booking;

  return v_booking;
end;
$$;

grant execute on function create_booking to authenticated, anon;