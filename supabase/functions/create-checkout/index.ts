// supabase/functions/create-checkout/index.ts
//
// Phase 2 of online payments. Creates a PayMongo Checkout Session for a
// booking's deposit, using the OWNING BARBER'S OWN PayMongo secret key
// (Model 1 — see chat: the platform never holds business funds). This is
// the only place that key is ever decrypted; it never reaches the browser.
//
// Deliberately does NOT touch payment_status beyond what create_booking (SQL,
// Phase 1) already set to 'pending' — this function only records that a
// checkout was started (payment_provider, payment_reference, checkout URL).
// Marking a booking as actually paid is Phase 3's job (webhook-verified),
// never this endpoint, and never just because a session was created.
//
// Required Supabase secrets: NONE beyond what every Edge Function already
// gets automatically (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) — there is no
// platform-wide PayMongo key, by design. Each business's own key lives in
// Supabase Vault (see 0017 migration) and is looked up per-booking.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// One place to build a customer-safe message — the actual technical reason
// is always logged server-side (console.error) and never sent to the client.
const GENERIC_ERROR = "Unable to start payment. Please try again.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: GENERIC_ERROR }, 405);
  }

  let bookingId: string | undefined;
  let method: string | undefined;
  try {
    const body = await req.json();
    bookingId = body?.bookingId;
    method = body?.method;
  } catch {
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }

  if (!bookingId || (method !== "gcash" && method !== "maya")) {
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }

  // Service-role client: bypasses RLS deliberately — this function IS the
  // trusted server-side boundary. No user JWT is used or required, since
  // customers booking are frequently anonymous; every value driving the
  // charge (amount, barber, method availability) comes from OUR database,
  // never from the request body except which booking/method to act on.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, barber_id, deposit_amount, payment_status, payment_provider, services ( name )")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError || !booking) {
    console.error("create-checkout: booking lookup failed:", bookingError);
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }

  // Only a booking that genuinely still needs its deposit paid may start a
  // new checkout — blocks re-paying an already-settled or deposit-less
  // booking, and blocks a stale/replayed request after payment_status moves
  // on (e.g. once Phase 3's webhook marks it paid).
  if (booking.payment_status !== "pending" || !(Number(booking.deposit_amount) > 0)) {
    return jsonResponse({ error: "This booking doesn't have a deposit waiting to be paid." }, 400);
  }

  const { data: barber, error: barberError } = await supabase
    .from("barbers")
    .select("id, shop_name, booking_settings, paymongo_connected")
    .eq("id", booking.barber_id)
    .maybeSingle();

  if (barberError || !barber) {
    console.error("create-checkout: barber lookup failed:", barberError);
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }

  const settings = barber.booking_settings || {};
  const methodEnabled = Boolean(settings.payment_methods?.[method]);
  if (!settings.online_payments_enabled || !methodEnabled || !barber.paymongo_connected) {
    return jsonResponse({ error: "This barber doesn't accept online payments for that method." }, 400);
  }

  const { data: secretKey, error: secretError } = await supabase.rpc("get_paymongo_secret_key", {
    p_barber_id: barber.id,
  });
  if (secretError || !secretKey) {
    console.error("create-checkout: secret key lookup failed:", secretError);
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }

  const origin = req.headers.get("origin") || Deno.env.get("PUBLIC_APP_URL") || "";
  const amountCentavos = Math.round(Number(booking.deposit_amount) * 100); // PayMongo amounts are in centavos, never a float peso value
  const serviceName = booking.services?.name || "Appointment";

  // PayMongo's `payment_method_types` enum uses "paymaya" for what the
  // product now brands as "Maya" (a legacy API name, per their docs as of
  // this writing) — worth double-checking against the live API reference
  // once real sandbox keys are in hand, in case this has since been renamed.
  const paymentMethodTypes = method === "gcash" ? ["gcash"] : ["paymaya"];

  let checkoutSession;
  try {
    const resp = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(secretKey + ":"),
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [
              {
                currency: "PHP",
                amount: amountCentavos,
                name: `Deposit — ${serviceName}`,
                quantity: 1,
              },
            ],
            payment_method_types: paymentMethodTypes,
            description: `Deposit for ${serviceName} at ${barber.shop_name}`,
            send_email_receipt: false,
            show_line_items: true,
            success_url: `${origin}/booking-payment-return?booking=${booking.id}`,
            cancel_url: `${origin}/booking-payment-return?booking=${booking.id}&cancelled=1`,
          },
        },
      }),
    });

    const payload = await resp.json();
    if (!resp.ok) {
      console.error("create-checkout: PayMongo API error:", JSON.stringify(payload));
      return jsonResponse({ error: GENERIC_ERROR }, 502);
    }
    checkoutSession = payload?.data;
  } catch (err) {
    console.error("create-checkout: PayMongo request failed:", err);
    return jsonResponse({ error: GENERIC_ERROR }, 502);
  }

  const checkoutUrl = checkoutSession?.attributes?.checkout_url;
  if (!checkoutUrl) {
    console.error("create-checkout: no checkout_url in PayMongo response:", JSON.stringify(checkoutSession));
    return jsonResponse({ error: GENERIC_ERROR }, 502);
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      payment_provider: method,
      payment_reference: checkoutSession.id,
    })
    .eq("id", booking.id);

  if (updateError) {
    // The checkout session already exists on PayMongo's side at this point —
    // failing to record it locally shouldn't block the customer from paying,
    // so this is logged but not treated as a hard failure.
    console.error("create-checkout: failed to save payment_reference:", updateError);
  }

  return jsonResponse({ checkoutUrl });
});