import { supabase } from "../lib/supabaseClient";

const SELECT_WITH_JOINS = `
  id, date, start_time, duration_minutes, status, reference_photo_url, notes,
  location_type, location_address, location_lat, location_lng,
  total_amount, deposit_type, deposit_value, deposit_amount, remaining_balance,
  payment_status, payment_provider, payment_reference, payment_transaction_id, payment_expires_at, paid_at,
  customers ( name, phone, email ),
  services ( name, price ),
  hair_styles ( name ),
  barber_staff ( name )
`;

/** All of a barber's bookings, with customer/service/style joined in one query.
 * RLS ("bookings: select barber or customer") already scopes this to the
 * authenticated barber's own bookings — no barber_id filter needs to be
 * (or should be) trusted from the client. */
export async function listBookingsForBarber(barberId) {
  const { data, error } = await supabase
    .from("bookings")
    .select(SELECT_WITH_JOINS)
    .eq("barber_id", barberId)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) {
    console.error("listBookingsForBarber failed:", error);
    throw error;
  }
  return data;
}

/** Confirm or cancel — the only status transitions this phase exposes.
 * Protected by the existing "bookings: barber update" RLS policy; a barber
 * can't update another barber's row no matter what id is passed here. */
export async function updateBookingStatus(bookingId, status) {
  const { data, error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", bookingId)
    .select(SELECT_WITH_JOINS)
    .single();
  if (error) {
    console.error("updateBookingStatus failed:", error);
    throw error;
  }
  return data;
}

/** Generates a short-lived signed URL for a private reference photo, on demand
 * (not eagerly for every appointment in the list). Relies entirely on the
 * "reference-photos: barber read" storage policy — Supabase itself refuses to
 * sign a URL for an object the caller can't SELECT, so this naturally fails
 * for another barber's photo without any extra check here. */
export async function getReferencePhotoUrl(path) {
  const { data, error } = await supabase.storage.from("reference-photos").createSignedUrl(path, 600); // 10 min
  if (error) {
    console.error("getReferencePhotoUrl failed:", error);
    throw error;
  }
  return data.signedUrl;
}