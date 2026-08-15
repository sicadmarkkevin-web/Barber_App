-- 0010_phase3c_reference_photos.sql
-- Additive only — does not modify 0001-0009.
--
-- Inspection findings (see chat): reference-photos bucket, bookings.reference_photo_url,
-- and create_booking's p_reference_photo_url parameter all already existed from Phase 1 —
-- none of that is new. What's actually being fixed here:
--
-- The existing reference-photos SELECT policy (0004) keys access on the first path
-- segment matching a `customers.id`. But a customer row doesn't exist until
-- create_booking creates one — so at the moment a customer picks a photo, mid-booking,
-- there is no customer_id yet to build a compliant path from. The path convention is
-- changed to `{barber_id}/{filename}` instead (barber_id is known upfront, before the
-- booking exists), and the read policy is updated to match: the owning barber can read
-- it, keyed the same way every other bucket in this app already scopes access
-- (barber_id folder prefix -> barbers.owner_profile_id = auth.uid()).
--
-- Customer read-access to their own uploaded photo is intentionally not preserved here
-- — no feature needs it yet (customers don't have accounts or booking history in this
-- app), and it's straightforward to add back once that exists. The bucket's INSERT
-- policy (0004) was already unrestricted on path, so upload itself needed no change.
--
-- create_booking also gains one more check, the same pattern as 0008's style-ownership
-- check: if a reference photo path is submitted, it must actually start with this
-- barber's own id, so a booking can never be created carrying another barber's photo
-- path. Signature and return type unchanged; every other existing check is untouched.

drop policy if exists "reference-photos: owner or barber read" on storage.objects;

create policy "reference-photos: barber read"
  on storage.objects for select
  using (
    bucket_id = 'reference-photos'
    and exists (
      select 1 from barbers b
      where b.id::text = (storage.foldername(name))[1]
        and b.owner_profile_id = auth.uid()
    )
  );

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
  v_caller_profile_id uuid := auth.uid();
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

  -- NEW: a submitted reference photo path must belong to this barber (path
  -- convention is "{barber_id}/{filename}" — see 0010 header note).
  if p_reference_photo_url is not null and p_reference_photo_url not like (p_barber_id::text || '/%') then
    raise exception 'That reference photo is not valid for this booking.';
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
