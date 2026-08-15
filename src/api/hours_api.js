import { supabase } from "../lib/supabaseClient";
import { DAYS_MON_FIRST } from "../utils/time";

/**
 * Returns all 7 days for this barber, Monday-first, filling in a sensible
 * default (open, 09:00-18:00) for any day that has no row yet — a fresh
 * barber has no business_hours rows at all until they save once.
 */
export async function getWeeklyHours(barberId) {
  const { data, error } = await supabase
    .from("business_hours")
    .select("day_of_week, is_closed, open_time, close_time")
    .eq("barber_id", barberId);
  if (error) {
    console.error("getWeeklyHours failed:", error);
    throw error;
  }

  const byDay = new Map(data.map((row) => [row.day_of_week, row]));
  return DAYS_MON_FIRST.map(({ day_of_week, label }) => {
    const existing = byDay.get(day_of_week);
    return {
      day_of_week,
      label,
      is_closed: existing?.is_closed ?? false,
      open_time: (existing?.open_time || "09:00:00").slice(0, 5),
      close_time: (existing?.close_time || "18:00:00").slice(0, 5),
    };
  });
}

/** Upserts all 7 days in one call — safe to call repeatedly, never creates duplicates
 * thanks to the existing unique(barber_id, day_of_week) constraint. */
export async function saveWeeklyHours(barberId, days) {
  const rows = days.map((d) => ({
    barber_id: barberId,
    day_of_week: d.day_of_week,
    is_closed: d.is_closed,
    open_time: d.open_time,
    close_time: d.close_time,
  }));
  const { error } = await supabase.from("business_hours").upsert(rows, { onConflict: "barber_id,day_of_week" });
  if (error) {
    console.error("saveWeeklyHours failed:", error);
    throw error;
  }
}

/**
 * Public — which weekdays (0=Sun..6=Sat) this barber is closed on, used to
 * gray out those days in the booking calendar before a date is even picked.
 * Only ever the shop/solo-level fallback hours — the staff-specific version
 * lives in api/staff.js as getStaffClosedWeekdays.
 */
export async function getClosedWeekdays(barberId) {
  const { data, error } = await supabase
    .from("business_hours")
    .select("day_of_week, is_closed")
    .eq("barber_id", barberId);
  if (error) {
    console.error("getClosedWeekdays failed:", error);
    throw error;
  }
  return data.filter((d) => d.is_closed).map((d) => d.day_of_week);
}

/**
 * Whether this barber has ever saved their weekly hours at all — distinct
 * from getWeeklyHours, which always fabricates 7 default (open, 09:00-18:00)
 * days client-side for display even when nothing has actually been saved.
 * Used by the dashboard's profile-completion checklist.
 */
export async function hasSavedBusinessHours(barberId) {
  const { count, error } = await supabase
    .from("business_hours")
    .select("day_of_week", { count: "exact", head: true })
    .eq("barber_id", barberId);
  if (error) {
    console.error("hasSavedBusinessHours failed:", error);
    throw error;
  }
  return (count || 0) > 0;
}
