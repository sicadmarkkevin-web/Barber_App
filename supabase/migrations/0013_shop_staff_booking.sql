-- 0013_shop_staff_booking.sql
-- Phase 2 of "solo vs shop" support: wires bookings.staff_id (added in 0012,
-- unused until now) into real double-booking protection, availability, and
-- booking creation, and adds a customer-facing "choose your barber" step.
-- Additive only — does not modify 0001-0012, except for create_booking and
-- get_available_slots, which this migration DROPs and recreates (not just
-- CREATE OR REPLACE) because their argument list is changing; see note below.
--
-- Design:
--  - Availability and double-booking are now scoped to (barber_id, staff_id)
--    instead of just barber_id. Two different staff at the same shop can now
--    be booked into overlapping times — they're different people. A booking
--    with no staff_id (solo accounts, or a shop account before it ever
--    required a staff pick) is treated as its own bucket via
--    coalesce(staff_id, a fixed sentinel uuid), so it still only conflicts
--    with other staff_id-less bookings for that same barber — solo behavior
--    is completely unchanged.
--  - A staff member's hours come from staff_business_hours (0012); a booking
--    with no staff_id keeps using business_hours exactly as before — this is
--    why solo accounts, and any shop booking made before staff selection
--    existed, are unaffected.
--  - A shop account with at least one active staff member now REQUIRES a
--    staff_id on every booking (customer must pick who they're booking
--    with); a shop with zero active staff, or a solo account, does not.

-- ---------------------------------------------------------------------------
-- 1. Double-booking constraint (0008) becomes staff-aware.
-- ---------------------------------------------------------------------------
alter table bookings drop constraint if exists bookings_no_overlap;
alter table bookings add constraint bookings_no_overlap
  exclude using gist (
    barber_id with =,
    coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    time_range with &&
  )
  where (status <> 'cancelled');

-- ---------------------------------------------------------------------------
-- 2. get_available_slots gains p_staff_id. Signature is changing (new
-- parameter), so the old 3-arg version is dropped first — CREATE OR REPLACE
-- would otherwise leave both overloads in place, which risks PostgREST
-- picking the wrong one.
-- ---------------------------------------------------------------------------
drop function if exists get_available_slots(uuid, uuid, date);

create or replace function get_available_slots(
  p_barber_id uuid,
  p_service_id uuid,
  p_date date,
  p_staff_id uuid default null
)
returns table(slot_start timestamp, slot_end timestamp, slot_label text)
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
  v_now_local timestamp;
  v_today_local date;
  v_min_advance_minutes int;
  v_max_advance_days int;
  v_buffer_minutes int;
  v_slot_interval int;
  v_earliest_start timestamp;
  v_latest_start timestamp;
  v_candidate_start timestamp;
  v_candidate_end timestamp;
begin
  select * into v_barber from barbers where id = p_barber_id;
  if not found then
    return;
  end if;

  select * into v_service from services
    where id = p_service_id and barber_id = p_barber_id and active = true;
  if not found then
    return;
  end if;

  -- If a staff id was passed, it must actually belong to this barber and be
  -- active — same ownership check as the service above.
  if p_staff_id is not null and not exists (
    select 1 from barber_staff s where s.id = p_staff_id and s.barber_id = p_barber_id and s.active = true
  ) then
    return;
  end if;

  v_min_advance_minutes := coalesce((v_barber.booking_settings->>'min_advance_minutes')::int, 60);
  v_max_advance_days := coalesce((v_barber.booking_settings->>'max_advance_days')::int, 30);
  v_buffer_minutes := coalesce((v_barber.booking_settings->>'buffer_minutes')::int, 0);
  v_slot_interval := coalesce((v_barber.booking_settings->>'slot_interval_minutes')::int, 15);
  if v_slot_interval <= 0 then
    v_slot_interval := 15;
  end if;

  v_now_local := now() at time zone v_barber.timezone;
  v_today_local := v_now_local::date;

  if p_date < v_today_local or p_date > v_today_local + v_max_advance_days then
    return;
  end if;

  if exists (select 1 from blocked_dates where barber_id = p_barber_id and date = p_date) then
    return;
  end if;

  v_day_of_week := extract(dow from p_date)::int;

  -- Hours source: the chosen staff member's own hours when one was picked,
  -- otherwise the shop/solo-level business_hours — unchanged fallback for
  -- solo accounts and staff-less shop bookings.
  if p_staff_id is not null then
    select * into v_staff_hours from staff_business_hours
      where staff_id = p_staff_id and day_of_week = v_day_of_week;
    if not found or v_staff_hours.is_closed then
      return;
    end if;
    v_earliest_start := p_date + v_staff_hours.open_time;
    v_latest_start := p_date + v_staff_hours.close_time - make_interval(mins => v_service.duration_minutes);
  else
    select * into v_hours from business_hours where barber_id = p_barber_id and day_of_week = v_day_of_week;
    if not found or v_hours.is_closed then
      return;
    end if;
    v_earliest_start := p_date + v_hours.open_time;
    v_latest_start := p_date + v_hours.close_time - make_interval(mins => v_service.duration_minutes);
  end if;

  v_candidate_start := v_earliest_start;
  while v_candidate_start <= v_latest_start loop
    v_candidate_end := v_candidate_start + make_interval(mins => v_service.duration_minutes);

    if v_candidate_start >= v_now_local + make_interval(mins => v_min_advance_minutes) then

      -- Overlap check, now scoped to this staff member (or the shared
      -- staff-less bucket when p_staff_id is null) instead of the whole shop.
      if not exists (
        select 1 from bookings bk
        where bk.barber_id = p_barber_id
          and coalesce(bk.staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce(p_staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
          and bk.date = p_date
          and bk.status <> 'cancelled'
          and (bk.date + bk.start_time) < v_candidate_end
          and (bk.date + bk.start_time + make_interval(mins => bk.duration_minutes) + make_interval(mins => v_buffer_minutes)) > v_candidate_start
      ) then
        slot_start := v_candidate_start;
        slot_end := v_candidate_end;
        slot_label := to_char(v_candidate_start, 'HH12:MI AM');
        return next;
      end if;
    end if;

    v_candidate_start := v_candidate_start + make_interval(mins => v_slot_interval);
  end loop;

  return;
end;
$$;

grant execute on function get_available_slots to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. create_booking gains p_staff_id. Same drop-then-create reasoning as
-- get_available_slots above. Every other check (service ownership, style
-- ownership, blocked dates) is byte-for-byte the same as 0008's version.
-- ---------------------------------------------------------------------------
drop function if exists create_booking(uuid, uuid, date, time, text, text, text, uuid, text, text);

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
  p_staff_id uuid default null
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

  -- Staff validation: a submitted staff_id must belong to this barber and be
  -- active. A shop account with at least one active staff member requires
  -- one to be submitted at all — a customer must pick who they're booking
  -- with. Solo accounts, and shop accounts with no active staff yet, are
  -- unaffected (p_staff_id stays null, exactly like before this migration).
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

  -- Conflict check, scoped to this staff member (or the shared staff-less
  -- bucket) instead of the whole shop — mirrors the gist constraint above,
  -- kept as a fast pre-check with a friendlier error message; the gist
  -- constraint is still what actually guarantees correctness under a race.
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
    duration_minutes, status, deposit_status, reference_photo_url, notes, staff_id
  ) values (
    p_barber_id, v_customer_id, p_service_id, p_hair_style_id, p_date, p_start_time,
    v_service.duration_minutes, 'pending',
    case when v_deposit_required then 'pending' else 'not_required' end,
    p_reference_photo_url, p_notes, p_staff_id
  )
  returning * into v_booking;

  return v_booking;
end;
$$;

grant execute on function create_booking to authenticated, anon;