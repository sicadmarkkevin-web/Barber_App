-- 0009_phase3b_availability.sql
-- Additive only — does not modify 0001-0008.
--
-- One function, get_available_slots(barber, service, date), is the entire
-- availability engine. It deliberately duplicates none of Phase 1-3A's
-- stored configuration — it reads business_hours, services.duration_minutes,
-- barbers.booking_settings (min_advance_minutes / max_advance_days /
-- buffer_minutes / slot_interval_minutes — all already existed from Phase 1,
-- none invented here), blocked_dates, and bookings directly, the same tables
-- create_booking already uses. This is why a SQL function was chosen over a
-- JS implementation: any drift between "what the browser thinks is
-- available" and "what the database actually has" is prevented by having
-- both the display layer and create_booking's final revalidation ultimately
-- backed by the same stored data — this function itself is NOT the source of
-- truth for whether a booking succeeds, create_booking's own checks (0003,
-- tightened in 0008) still are. This function only tells the customer what
-- looks available; nothing here weakens or replaces Phase 3A's double-
-- booking protection.
--
-- SECURITY DEFINER, same reasoning as create_booking: an anonymous customer
-- calling this needs the true picture of existing bookings to get accurate
-- availability, but bookings has no public SELECT policy (correctly, per
-- 0002/0008 — customer PII lives in `customers`, joined by other tables, and
-- must never be queryable by a stranger). This function only ever returns
-- {start, end, label} — no customer_id, no names, no phone/email, no notes,
-- nothing from `customers` at all.
--
-- Timezone: uses barbers.timezone (already existed since Phase 1) to convert
-- now() to the barber's local wall-clock time via `now() AT TIME ZONE
-- b.timezone`. This is not new timezone complexity — date/start_time
-- everywhere else in this app (business_hours, bookings) are already stored
-- as local wall-clock values with no zone attached, and the ONLY way to
-- correctly compare "is this slot in the past" against that convention is to
-- convert the one genuinely timezone-aware value in the whole system (now(),
-- a real instant) into the same local frame — not doing this conversion is
-- what would actually cause incorrect results for PH-based barbers whenever
-- the database server's own clock is UTC.
--
-- Multiple business-hour blocks per day: not supported, because
-- business_hours (Phase 1/2D) only stores one open/close pair per day. Per
-- this phase's own instructions, that's not being redesigned here.

create or replace function get_available_slots(
  p_barber_id uuid,
  p_service_id uuid,
  p_date date
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
  -- Barber must exist. (No "active"/"suspended" flag exists anywhere in the
  -- schema yet, so existence is the only check available — same finding as
  -- Phase 3A.) Return zero rows rather than raising, so a bad/unknown
  -- username never leaks whether that's "no barber" vs. "no availability".
  select * into v_barber from barbers where id = p_barber_id;
  if not found then
    return;
  end if;

  -- Service must belong to this barber and be active — identical ownership
  -- check to create_booking, so a service ID can never be borrowed across
  -- barbers here either.
  select * into v_service from services
    where id = p_service_id and barber_id = p_barber_id and active = true;
  if not found then
    return;
  end if;

  v_min_advance_minutes := coalesce((v_barber.booking_settings->>'min_advance_minutes')::int, 60);
  v_max_advance_days := coalesce((v_barber.booking_settings->>'max_advance_days')::int, 30);
  v_buffer_minutes := coalesce((v_barber.booking_settings->>'buffer_minutes')::int, 0);
  v_slot_interval := coalesce((v_barber.booking_settings->>'slot_interval_minutes')::int, 15);
  if v_slot_interval <= 0 then
    v_slot_interval := 15; -- guard against a bad stored value causing an infinite loop below
  end if;

  v_now_local := now() at time zone v_barber.timezone;
  v_today_local := v_now_local::date;

  -- Past dates and dates beyond the max advance window: no availability.
  if p_date < v_today_local or p_date > v_today_local + v_max_advance_days then
    return;
  end if;

  -- Blocked date: no availability.
  if exists (select 1 from blocked_dates where barber_id = p_barber_id and date = p_date) then
    return;
  end if;

  -- Closed that day (or no hours configured at all yet): no availability.
  v_day_of_week := extract(dow from p_date)::int;
  select * into v_hours from business_hours where barber_id = p_barber_id and day_of_week = v_day_of_week;
  if not found or v_hours.is_closed then
    return;
  end if;

  v_earliest_start := p_date + v_hours.open_time;
  -- Every candidate must finish by closing time — enforced by simply never
  -- generating a start later than (close - duration), rather than filtering
  -- after the fact.
  v_latest_start := p_date + v_hours.close_time - make_interval(mins => v_service.duration_minutes);

  v_candidate_start := v_earliest_start;
  while v_candidate_start <= v_latest_start loop
    v_candidate_end := v_candidate_start + make_interval(mins => v_service.duration_minutes);

    -- Minimum notice: skip candidates too soon from "now" in the barber's
    -- own local time.
    if v_candidate_start >= v_now_local + make_interval(mins => v_min_advance_minutes) then

      -- Overlap check: an existing non-cancelled booking blocks candidates
      -- from its own start through (its end + buffer) — buffer only trails
      -- each booking, matching the buffer example in the brief exactly
      -- (10:00-10:30 booking + 10min buffer protects through 10:40, but a
      -- booking ending exactly when a candidate starts, with no buffer, is
      -- not a conflict — same strict-inequality convention create_booking
      -- already uses, not a second divergent definition of "overlap").
      if not exists (
        select 1 from bookings bk
        where bk.barber_id = p_barber_id
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

-- Callable by both signed-in and anonymous (guest) customers, same as
-- create_booking — the function's own checks are what keep this safe, not
-- the grant.
grant execute on function get_available_slots to authenticated, anon;
