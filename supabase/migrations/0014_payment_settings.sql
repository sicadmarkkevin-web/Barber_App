-- 0014_payment_settings.sql
-- Phase 1 of online payments: settings + deposit calculation + database
-- prep ONLY. No gateway integration, no checkout, no webhooks — see chat.
-- Additive only — does not modify 0001-0015.
--
-- Inspected first (see chat):
--   - barbers.booking_settings (jsonb, from 0001) already had deposit_required
--     (bool), deposit_type ('fixed' only), and deposit_amount default keys —
--     but they were NEVER exposed in BookingSettingsManager's UI, and
--     deposit_type never supported 'percentage' or 'none' as real states.
--     This migration doesn't change the column (jsonb needs none to add
--     keys) — BOOKING_SETTINGS_DEFAULTS in utils/bookingSettings.js is
--     extended instead, same pattern already used for home_service_enabled.
--   - bookings.deposit_status (from 0001: not_required/pending/submitted/
--     verified) is a narrower, older field that is not referenced ANYWHERE
--     in the frontend (confirmed by search) — it's dormant. Rather than
--     repurpose it to fit a richer lifecycle it was never designed for, this
--     migration adds the richer `payment_status` this phase actually needs
--     and leaves `deposit_status` untouched (unused, but not removed, per
--     "do not break existing functionality" — a future phase can retire it).
--   - No existing "business/organization" table — this project's equivalent
--     is `barbers` (confirmed with the user), so payment settings live in
--     barbers.booking_settings, same place every other booking-page setting
--     already lives.
--   - No RLS changes needed: RLS is row-level, not column-level. barbers'
--     existing public-select/owner-write policies (0002) already cover the
--     new booking_settings keys the same way they cover every existing key
--     in that jsonb column. bookings' existing "select barber or customer"
--     policy (0002) already scopes every new column added here to the
--     owning barber or that booking's own customer — no unrelated barber or
--     customer can see another business's payment fields.

-- ---------------------------------------------------------------------------
-- 0. Update barbers.booking_settings' column DEFAULT so barbers who sign up
-- from now on get the clean Phase-1 shape (deposit_type "none", not the old
-- never-exposed "fixed"/0 from 0001) from day one. This only affects the
-- default applied to NEW rows going forward — existing barbers already have
-- their own stored jsonb value and are unaffected; their legacy shape is
-- normalized client-side instead (see withBookingSettingsDefaults).
-- ---------------------------------------------------------------------------
alter table barbers alter column booking_settings set default '{
  "min_advance_minutes": 60,
  "max_advance_days": 30,
  "buffer_minutes": 0,
  "slot_interval_minutes": 15,
  "allow_style_selection": true,
  "manual_confirmation": false,
  "home_service_enabled": false,
  "online_payments_enabled": false,
  "payment_methods": {"gcash": false, "maya": false},
  "deposit_type": "none",
  "deposit_percent": 30,
  "deposit_amount": 0,
  "cancellation_notice_hours": 24
}'::jsonb;

-- ---------------------------------------------------------------------------
-- 1. bookings: payment fields. All nullable/defaulted so this is a pure
-- additive change for every existing row (they simply get payment_status =
-- 'unpaid', amount_paid = 0, everything else null, as if payments never
-- existed for them — which is accurate, since they predate this phase).
-- ---------------------------------------------------------------------------
alter table bookings add column if not exists total_amount numeric(10,2);
alter table bookings add column if not exists deposit_type text;
alter table bookings add column if not exists deposit_value numeric(10,2);
alter table bookings add column if not exists deposit_amount numeric(10,2) not null default 0;
alter table bookings add column if not exists amount_paid numeric(10,2) not null default 0;
alter table bookings add column if not exists remaining_balance numeric(10,2);
alter table bookings add column if not exists payment_status text not null default 'unpaid';
alter table bookings add column if not exists payment_provider text;
alter table bookings add column if not exists payment_reference text;
alter table bookings add column if not exists payment_transaction_id text;
alter table bookings add column if not exists payment_expires_at timestamptz;
alter table bookings add column if not exists paid_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_payment_status_check') then
    alter table bookings add constraint bookings_payment_status_check
      check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'expired', 'partially_paid', 'refunded'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_deposit_type_check') then
    alter table bookings add constraint bookings_deposit_type_check
      check (deposit_type is null or deposit_type in ('none', 'percentage', 'fixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_payment_provider_check') then
    alter table bookings add constraint bookings_payment_provider_check
      check (payment_provider is null or payment_provider in ('gcash', 'maya'));
  end if;
  -- Validation, per spec: amounts can't be negative, deposit can't exceed
  -- the total, remaining balance can't be negative.
  if not exists (select 1 from pg_constraint where conname = 'bookings_amount_paid_nonneg') then
    alter table bookings add constraint bookings_amount_paid_nonneg check (amount_paid >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_deposit_amount_nonneg') then
    alter table bookings add constraint bookings_deposit_amount_nonneg check (deposit_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_remaining_balance_nonneg') then
    alter table bookings add constraint bookings_remaining_balance_nonneg check (remaining_balance is null or remaining_balance >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_deposit_le_total') then
    alter table bookings add constraint bookings_deposit_le_total
      check (total_amount is null or deposit_amount <= total_amount);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. compute_deposit: the reusable server-side calculation the spec asks
-- for. Pure function (same inputs -> same output, no table access), used by
-- create_booking below and safe to reuse from any future payment RPC without
-- duplicating the rounding/clamping logic. numeric in, numeric out — never
-- floating point, so this is exact-decimal PHP-centavo-safe arithmetic.
-- ---------------------------------------------------------------------------
create or replace function compute_deposit(
  p_total numeric,
  p_deposit_type text,
  p_deposit_percent numeric,
  p_deposit_amount numeric
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_deposit numeric;
begin
  if p_total is null or p_total <= 0 then
    return 0;
  end if;

  if p_deposit_type = 'percentage' then
    -- A misconfigured percentage (missing, <=0, or >100) is treated as no
    -- deposit rather than failing a customer's booking over a barber's
    -- settings mistake — validation on the settings screen is what actually
    -- prevents this from being saved in the first place (see section 10).
    if p_deposit_percent is null or p_deposit_percent <= 0 or p_deposit_percent > 100 then
      return 0;
    end if;
    v_deposit := round(p_total * p_deposit_percent / 100, 2);
  elsif p_deposit_type = 'fixed' then
    if p_deposit_amount is null or p_deposit_amount < 0 then
      return 0;
    end if;
    v_deposit := p_deposit_amount;
  else
    return 0;
  end if;

  if v_deposit > p_total then
    v_deposit := p_total;
  end if;

  return v_deposit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. create_booking: computes and snapshots the payment breakdown at
-- booking time, same reasoning as 0015's location snapshot — if the barber
-- later changes their deposit settings, past bookings must keep showing
-- what was actually true when they were made. Signature is UNCHANGED (the
-- deposit config comes from the barber's own settings, not something the
-- customer submits), so this is a plain CREATE OR REPLACE, not a
-- drop-then-create — every existing check (service/style/staff validation,
-- hours, blocked dates, conflicts, location from 0015) is byte-for-byte the
-- same as 0015's version, only the payment block and the final INSERT are
-- new.
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
grant execute on function compute_deposit to authenticated, anon;