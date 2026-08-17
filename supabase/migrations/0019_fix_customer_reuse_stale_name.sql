-- 0019_fix_customer_reuse_stale_name.sql
-- Fixes: repeat bookings from the same logged-in profile all showing
-- whatever name was typed on the FIRST booking ever made from that account,
-- ignoring different names typed on later bookings.
--
-- Root cause: create_booking's "returning customer" lookup (matches by
-- auth.uid()) correctly avoided creating duplicate customer rows for the
-- same signed-in profile, but never updated that row's name/phone/email on
-- reuse — so it stayed frozen at whatever was submitted the very first
-- time. In production this only affects a genuinely signed-in, returning
-- customer (this app never requires customers to have accounts, so a real
-- anonymous customer always gets a fresh, correctly-named row); it's most
-- commonly hit while a barber tests their own public booking page in the
-- same browser session as their own dashboard login, which is exactly what
-- was reported.
--
-- Fix: when reusing an existing customer row, update it with the just-
-- submitted name/phone/email instead of leaving it stale. Signature is
-- unchanged — every other check (service/style/staff, hours, blocked
-- dates, conflicts, location, payment) is byte-for-byte the same as
-- 0016's version; only the customer-lookup block changes.

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

  -- CHANGED: keep the reused customer row's contact details current on
  -- every booking, instead of leaving them frozen at whatever was typed
  -- the first time this profile ever booked.
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

  -- Payment breakdown, computed server-side (never trusting a client-supplied
  -- amount) from the service's actual price and the barber's OWN current
  -- deposit settings — there is no p_deposit_* parameter on this function on
  -- purpose. Missing keys (a barber who onboarded before this phase) default
  -- to 'none' via coalesce, so old accounts behave exactly as before: no
  -- deposit, payment_status stays 'unpaid'.
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

  insert into bookings (
    barber_id, customer_id, service_id, hair_style_id, date, start_time,
    duration_minutes, status, reference_photo_url, notes, staff_id,
    location_type, location_address, location_lat, location_lng,
    total_amount, deposit_type, deposit_value, deposit_amount, remaining_balance, payment_status
  ) values (
    p_barber_id, v_customer_id, p_service_id, p_hair_style_id, p_date, p_start_time,
    v_service.duration_minutes, 'pending',
    p_reference_photo_url, p_notes, p_staff_id,
    p_location_type, v_location_address, v_location_lat, v_location_lng,
    v_service.price, v_deposit_type, v_deposit_value, v_deposit_amount,
    v_service.price - v_deposit_amount, v_payment_status
  )
  returning * into v_booking;

  return v_booking;
end;
$$;

grant execute on function create_booking to authenticated, anon;