import { supabase } from "../lib/supabaseClient";
import { DAYS_MON_FIRST } from "../utils/time";

const SELECT_FIELDS = "id, barber_id, name, photo_url, bio, active, sort_order";

/** All of a shop's staff (owner view — dashboard). Ordered by sort_order. */
export async function listStaffForBarber(barberId) {
  const { data, error } = await supabase
    .from("barber_staff")
    .select(SELECT_FIELDS)
    .eq("barber_id", barberId)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("listStaffForBarber failed:", error);
    throw error;
  }
  return data;
}

/** Public view — only active staff, for the /:username booking flow (Phase 2). */
export async function listActiveStaffForBarber(barberId) {
  const { data, error } = await supabase
    .from("barber_staff")
    .select(SELECT_FIELDS)
    .eq("barber_id", barberId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("listActiveStaffForBarber failed:", error);
    throw error;
  }
  return data;
}

/** Appends a new staff member after the shop's current last one. Pass `id` when a
 * photo was already uploaded to a path keyed by that id before this call. */
export async function createStaff(barberId, { id, name, bio, photoUrl }) {
  const { data: last, error: lastError } = await supabase
    .from("barber_staff")
    .select("sort_order")
    .eq("barber_id", barberId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (lastError) {
    console.error("createStaff (reading sort_order) failed:", lastError);
    throw lastError;
  }
  const nextOrder = last?.length ? last[0].sort_order + 1 : 0;

  const insertPayload = {
    barber_id: barberId,
    name,
    bio: bio || null,
    photo_url: photoUrl || null,
    sort_order: nextOrder,
  };
  if (id) insertPayload.id = id;

  const { data, error } = await supabase
    .from("barber_staff")
    .insert(insertPayload)
    .select(SELECT_FIELDS)
    .single();
  if (error) {
    console.error("createStaff failed:", error);
    throw error;
  }
  return data;
}

export async function updateStaff(id, { name, bio, photoUrl, active }) {
  const { data, error } = await supabase
    .from("barber_staff")
    .update({ name, bio: bio || null, photo_url: photoUrl || null, active })
    .eq("id", id)
    .select(SELECT_FIELDS)
    .single();
  if (error) {
    console.error("updateStaff failed:", error);
    throw error;
  }
  return data;
}

export async function deleteStaff(id) {
  const { error } = await supabase.from("barber_staff").delete().eq("id", id);
  if (error) {
    console.error("deleteStaff failed:", error);
    throw error;
  }
}

/** Best-effort image cleanup — called before deleteStaff when the staff member has a photo. */
export async function deleteStaffImage(barberId, staffId) {
  const { error } = await supabase.storage.from("profile-images").remove([`${barberId}/staff/${staffId}.jpg`]);
  if (error) {
    // Non-fatal: don't block the row delete over an orphaned storage file.
    console.error("deleteStaffImage failed (continuing anyway):", error);
  }
}

/**
 * Returns all 7 days for this staff member, Monday-first, filling in a
 * sensible default (open, 09:00-18:00) for any day that has no row yet —
 * mirrors getWeeklyHours in api/hours.js, keyed by staff_id instead.
 */
export async function getStaffWeeklyHours(staffId) {
  const { data, error } = await supabase
    .from("staff_business_hours")
    .select("day_of_week, is_closed, open_time, close_time")
    .eq("staff_id", staffId);
  if (error) {
    console.error("getStaffWeeklyHours failed:", error);
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

/** Upserts all 7 days in one call — safe to call repeatedly, thanks to unique(staff_id, day_of_week). */
export async function saveStaffWeeklyHours(staffId, days) {
  const rows = days.map((d) => ({
    staff_id: staffId,
    day_of_week: d.day_of_week,
    is_closed: d.is_closed,
    open_time: d.open_time,
    close_time: d.close_time,
  }));
  const { error } = await supabase.from("staff_business_hours").upsert(rows, { onConflict: "staff_id,day_of_week" });
  if (error) {
    console.error("saveStaffWeeklyHours failed:", error);
    throw error;
  }
}

/**
 * Public — which weekdays (0=Sun..6=Sat) this staff member is closed on,
 * used to gray out those days in the booking calendar once a barber is
 * picked. Mirrors getClosedWeekdays in api/hours.js, keyed by staff_id.
 */
export async function getStaffClosedWeekdays(staffId) {
  const { data, error } = await supabase
    .from("staff_business_hours")
    .select("day_of_week, is_closed")
    .eq("staff_id", staffId);
  if (error) {
    console.error("getStaffClosedWeekdays failed:", error);
    throw error;
  }
  return data.filter((d) => d.is_closed).map((d) => d.day_of_week);
}