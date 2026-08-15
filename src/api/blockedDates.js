import { supabase } from "../lib/supabaseClient";

/**
 * Public — one-off closed dates (e.g. a holiday) for this barber, within
 * [fromDate, toDate] so the query stays cheap regardless of how far back a
 * barber's blocked-date history goes. Used to gray out those days in the
 * booking calendar before a date is even picked. Shop-wide — blocked_dates
 * has no staff_id column, so this applies the same regardless of which
 * staff member is selected.
 */
export async function getBlockedDates(barberId, fromDate, toDate) {
  const { data, error } = await supabase
    .from("blocked_dates")
    .select("date")
    .eq("barber_id", barberId)
    .gte("date", fromDate)
    .lte("date", toDate);
  if (error) {
    console.error("getBlockedDates failed:", error);
    throw error;
  }
  return data.map((d) => d.date);
}