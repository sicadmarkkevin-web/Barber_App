-- 0003_create_booking_rpc.sql
-- The only way a booking row gets created. Runs as SECURITY DEFINER (owned by
-- the migration-running role, which has BYPASSRLS on Supabase) so it can both
-- read across tables and insert into `bookings`, which has no public INSERT
-- policy — see 0002_rls_policies.sql.
--
-- Double-booking prevention: pg_advisory_xact_lock serializes every booking
-- attempt for the same (barber, date) within this transaction, so two
-- concurrent requests for a brand-new slot can't both pass the overlap check
-- before either has inserted — the second waits for the first's transaction
-- to commit, then re-evaluates against the now-committed row. This handles
-- the "two people booking the same empty slot at once" race that a plain
-- SELECT-then-INSERT (or even SELECT ... FOR UPDATE, which only locks rows
-- that already exist) does not.

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
  -- Serialize all booking attempts for this barber+date so two requests for
  -- the same brand-new slot can't both slip through the checks below.
  perform pg_advisory_xact_lock(hashtext(p_barber_id::text || p_date::text));

  select * into v_service from services
    where id = p_service_id and barber_id = p_barber_id and active = true;
  if not found then
    raise exception 'That service is not available.';
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

  -- Reuse an existing customer record for a signed-in caller; otherwise
  -- create a guest customer row for this booking.
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

-- Allow both signed-in and anonymous (guest) callers to invoke the RPC —
-- the function itself is what enforces correctness, not the grant.
grant execute on function create_booking to authenticated, anon;
