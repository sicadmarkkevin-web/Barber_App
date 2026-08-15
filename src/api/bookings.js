import { supabase } from "../lib/supabaseClient";
import { uploadImage } from "../utils/image";

/**
 * Uploads a customer's reference photo to the existing private reference-photos
 * bucket, path "{barber_id}/{random}.jpg" (see 0010 migration for why barber_id,
 * not customer_id — no customer row exists yet at this point in the flow).
 * Returns the storage PATH, not a fetchable URL — the bucket is private, so
 * viewing it later (Phase 4, barber dashboard) requires a signed URL generated
 * from this path, not a plain public URL.
 */
export async function uploadReferencePhoto(barberId, file) {
  const path = `${barberId}/${crypto.randomUUID()}.jpg`;
  await uploadImage("reference-photos", path, file); // return value (a "public" URL) is meaningless for a private bucket — ignored
  return path;
}

export async function removeReferencePhoto(path) {
  if (!path) return;
  const { error } = await supabase.storage.from("reference-photos").remove([path]);
  if (error) {
    // Non-fatal — same reasoning as deleteStyleImage: don't block the customer
    // over an orphaned storage file.
    console.error("removeReferencePhoto failed (continuing anyway):", error);
  }
}

/**
 * The only way this app creates a booking — calls the existing create_booking
 * RPC (0003, tightened in 0008, extended in 0010). No client-side insert into
 * `bookings` exists anywhere; that table has no INSERT policy for exactly this
 * reason. This function does no validation of its own — create_booking is the
 * sole authority, and re-checks everything (service ownership, style
 * ownership, reference-photo ownership, business hours, blocked dates,
 * double-booking) regardless of what the customer saw on screen a moment
 * earlier.
 */
export async function createBooking({
  barberId,
  serviceId,
  date,
  startTime, // "HH:MM" or "HH:MM:SS"
  hairStyleId,
  referencePhotoPath,
  customerName,
  customerPhone,
  customerEmail,
  staffId,
}) {
  const { data, error } = await supabase.rpc("create_booking", {
    p_barber_id: barberId,
    p_service_id: serviceId,
    p_date: date,
    p_start_time: startTime,
    p_customer_name: customerName,
    p_customer_phone: customerPhone || null,
    p_customer_email: customerEmail || null,
    p_hair_style_id: hairStyleId || null,
    p_reference_photo_url: referencePhotoPath || null,
    p_staff_id: staffId || null,
  });
  if (error) {
    console.error("createBooking (RPC create_booking) failed:", error);
    throw error;
  }
  return data;
}

/**
 * create_booking's own raised messages are already written for a customer to
 * read (see 0003/0008's `raise exception` text) — this just normalizes them
 * to the exact copy this phase's brief specifies, and gives every
 * unrecognized/network-level failure one safe generic fallback rather than
 * ever surfacing raw Postgres error text.
 */
export function friendlyBookingError(error) {
  const msg = error?.message || "";
  if (/just booked/i.test(msg)) {
    return "Sorry, that time was just booked. Please choose another time.";
  }
  if (/please select a barber/i.test(msg)) {
    return "Please choose which barber you'd like to book with.";
  }
  if (/staff member is not available/i.test(msg)) {
    return "That barber is no longer available. Please choose another.";
  }
  if (/closed that day|outside business hours|outside that barber|not available that day|not available for booking/i.test(msg)) {
    return "This barber is not accepting bookings for this time.";
  }
  if (/service is not available/i.test(msg)) {
    return "That service is no longer available.";
  }
  if (/style is not available|does not offer style selection/i.test(msg)) {
    return "That style is no longer available. Please choose another.";
  }
  return "Something went wrong. Please try again.";
}