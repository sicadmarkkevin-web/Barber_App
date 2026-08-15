import { supabase } from "../lib/supabaseClient";

/**
 * Starts a PayMongo checkout for a booking's deposit. All the real work —
 * validating the barber accepts this method, looking up their own PayMongo
 * secret key, calling PayMongo, and recording the session — happens
 * server-side in the create-checkout Edge Function. This never sees or
 * touches any secret key.
 *
 * Returns the checkout URL to redirect the customer to. Does NOT mark
 * anything as paid — that's Phase 3's job, via webhook.
 */
export async function createCheckoutSession(bookingId, method) {
  const { data, error } = await supabase.functions.invoke("create-checkout", {
    body: { bookingId, method },
  });
  if (error) {
    console.error("createCheckoutSession failed:", error);
    throw new Error("Unable to start payment. Please try again.");
  }
  if (!data?.checkoutUrl) {
    throw new Error("Unable to start payment. Please try again.");
  }
  return data.checkoutUrl;
}

/**
 * Narrow, PII-free status check for the payment-return page — see
 * get_booking_payment_status (0018) for why this is safe for an anonymous
 * customer to call with just their own booking id.
 */
export async function getBookingPaymentStatus(bookingId) {
  const { data, error } = await supabase.rpc("get_booking_payment_status", { p_booking_id: bookingId });
  if (error) {
    console.error("getBookingPaymentStatus failed:", error);
    throw error;
  }
  return data?.[0] || null;
}