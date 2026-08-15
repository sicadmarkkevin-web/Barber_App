import { supabase } from "../lib/supabaseClient";

/**
 * Returns available appointment slots for a barber/service/date, computed
 * entirely by the get_available_slots() database function (0009 migration) —
 * this wrapper does no date/time/business-hours/buffer logic of its own, so
 * there's exactly one place that logic lives.
 *
 * Returns: [{ start, end, label }, ...]
 *   start/end: "YYYY-MM-DDTHH:MM:SS" local wall-clock strings (no timezone
 *              suffix — consistent with how date/start_time are stored
 *              everywhere else in this app)
 *   label:     e.g. "10:00 AM", formatted server-side so there's a single
 *              definition of "how a slot is displayed"
 *
 * Not authoritative — see create_booking (0003/0008), which revalidates
 * availability atomically at the moment of booking. This function only
 * answers "what looks available right now".
 */
export async function getAvailableSlots(barberId, serviceId, date, staffId) {
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_barber_id: barberId,
    p_service_id: serviceId,
    p_date: date, // "YYYY-MM-DD"
    p_staff_id: staffId || null,
  });
  if (error) {
    console.error("getAvailableSlots failed:", error);
    throw error;
  }
  return (data || []).map((row) => ({
    start: row.slot_start,
    end: row.slot_end,
    label: row.slot_label,
  }));
}