// supabase/functions/paymongo-webhook/index.ts
//
// Phase 3 of online payments. Receives PayMongo webhook events for ALL
// connected businesses (Model 1 means many different PayMongo accounts, one
// per barber, all pointing at this single URL). This is the ONLY place a
// booking's payment_status is ever authoritatively set to 'paid' — a
// customer returning from checkout is never enough (see PaymentReturn.jsx).
//
// Signature verification is per-business: each barber's webhook endpoint
// (registered by connect-paymongo) has its OWN secret, so we look up which
// booking/barber an event refers to BEFORE we can know which secret to
// verify it against. That lookup is a plain DB read (safe on its own — it
// doesn't grant trust); the signature check afterward is what actually
// decides whether to believe the payload.
//
// NOTE ON PAYLOAD SHAPE: the exact JSON path to the checkout session id and
// paid amount inside a `checkout_session.payment.paid` event is written from
// PayMongo's documented resource shapes, but hasn't been verified against a
// captured live event yet (no real PayMongo account was available to test
// against). If events aren't matching bookings once this goes live, log the
// raw payload (temporarily) and adjust extractCheckoutSessionId/extractPaidAmount
// below — everything else (signature verification, idempotency, atomic
// confirmation) does not depend on getting that path exactly right the
// first time.

import { createClient } from "npm:@supabase/supabase-js@2";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseSignatureHeader(header: string): { timestamp: string; test?: string; live?: string } {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k.trim(), v?.trim()];
    })
  );
  return { timestamp: parts.t, test: parts.te, live: parts.li };
}

// Best-effort extraction — see NOTE ON PAYLOAD SHAPE above.
function extractCheckoutSessionId(resource: any): string | null {
  return resource?.id && resource?.type === "checkout_session"
    ? resource.id
    : resource?.attributes?.checkout_session_id || resource?.attributes?.data?.id || null;
}
function extractPaidAmountCentavos(resource: any): number | null {
  const payment = resource?.attributes?.payments?.[0] || resource?.attributes?.data?.attributes || resource?.attributes;
  const amount = payment?.amount;
  return typeof amount === "number" ? amount : null;
}
function extractProviderPaymentId(resource: any): string {
  return resource?.attributes?.payments?.[0]?.id || resource?.id || "unknown";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signatureHeader = req.headers.get("Paymongo-Signature") || req.headers.get("paymongo-signature");
  const rawBody = await req.text(); // raw, unparsed — required for signature verification
  if (!signatureHeader) {
    console.error("paymongo-webhook: missing Paymongo-Signature header");
    return new Response("Missing signature", { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    console.error("paymongo-webhook: invalid JSON body");
    return new Response("Invalid payload", { status: 400 });
  }

  const eventId: string | undefined = event?.data?.id;
  const eventType: string | undefined = event?.data?.attributes?.type;
  const resource = event?.data?.attributes?.data;
  const livemode: boolean | undefined = event?.data?.attributes?.livemode;

  if (!eventId || !eventType) {
    console.error("paymongo-webhook: payload missing event id/type");
    return new Response("Invalid payload", { status: 400 });
  }

  const checkoutSessionId = extractCheckoutSessionId(resource);
  if (!checkoutSessionId) {
    // Not an event shape we track (e.g. a payment method or merchant event we
    // never subscribed to but could still theoretically receive) — acknowledge
    // so PayMongo doesn't retry something we'll never be able to act on.
    console.error("paymongo-webhook: could not extract checkout session id, event type:", eventType);
    return new Response("ok", { status: 200 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Look up which booking/barber this refers to. Safe on its own — this is
  // just a read, not a trust decision; the signature check right after is
  // what actually decides whether to believe anything in the payload.
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, barber_id, deposit_amount, payment_status, status")
    .eq("payment_reference", checkoutSessionId)
    .maybeSingle();

  if (bookingError || !booking) {
    console.error("paymongo-webhook: no booking found for checkout session", checkoutSessionId, bookingError);
    return new Response("ok", { status: 200 }); // nothing for us to do; don't make PayMongo retry forever
  }

  const { data: webhookSecret, error: secretError } = await supabase.rpc("get_paymongo_webhook_secret", {
    p_barber_id: booking.barber_id,
  });
  if (secretError || !webhookSecret) {
    console.error("paymongo-webhook: no webhook secret on file for barber", booking.barber_id, secretError);
    return new Response("Cannot verify signature", { status: 400 });
  }

  const { timestamp, test, live } = parseSignatureHeader(signatureHeader);
  const expected = livemode === false ? test : live;
  const expectedFallback = livemode === false ? live : test; // if livemode is absent, we'll check both below
  if (!timestamp || (!expected && !expectedFallback)) {
    console.error("paymongo-webhook: malformed signature header");
    return new Response("Invalid signature", { status: 400 });
  }

  const computed = await hmacSha256Hex(webhookSecret, timestamp + rawBody);
  const signatureValid =
    (expected && timingSafeEqual(computed, expected)) || (expectedFallback && timingSafeEqual(computed, expectedFallback));

  if (!signatureValid) {
    console.error("paymongo-webhook: signature verification failed for booking", booking.id);
    return new Response("Invalid signature", { status: 400 });
  }

  // Idempotency: a unique-violation here means this exact event was already
  // processed (PayMongo retries deliveries up to 12 times) — treat as a safe
  // no-op rather than reprocessing.
  const { error: ledgerError } = await supabase
    .from("payment_webhook_events")
    .insert({ provider: "paymongo", event_id: eventId, event_type: eventType, booking_id: booking.id });
  if (ledgerError) {
    if (ledgerError.code === "23505") {
      return new Response("ok", { status: 200 }); // already processed
    }
    console.error("paymongo-webhook: failed to record event in ledger:", ledgerError);
    return new Response("Temporary error", { status: 500 }); // let PayMongo retry
  }

  if (eventType === "checkout_session.payment.paid" || eventType === "payment.paid") {
    const amountCentavos = extractPaidAmountCentavos(resource);
    if (amountCentavos == null) {
      console.error("paymongo-webhook: could not extract paid amount from payload for booking", booking.id);
      return new Response("ok", { status: 200 }); // recorded in ledger; won't reprocess, but couldn't confirm — needs manual follow-up
    }
    const providerPaymentId = extractProviderPaymentId(resource);

    const { error: confirmError } = await supabase.rpc("confirm_deposit_paid", {
      p_booking_id: booking.id,
      p_provider_payment_id: providerPaymentId,
      p_amount_paid_centavos: amountCentavos,
    });
    if (confirmError) {
      // Most likely an amount mismatch, per confirm_deposit_paid's own check
      // — logged server-side only, never exposed to the customer.
      console.error("paymongo-webhook: confirm_deposit_paid failed for booking", booking.id, confirmError);
      return new Response("ok", { status: 200 }); // don't make PayMongo retry a mismatch forever
    }
  } else if (eventType === "payment.failed") {
    const providerPaymentId = extractProviderPaymentId(resource);
    const { error: failError } = await supabase.rpc("mark_payment_failed", {
      p_booking_id: booking.id,
      p_provider_payment_id: providerPaymentId,
    });
    if (failError) {
      console.error("paymongo-webhook: mark_payment_failed failed for booking", booking.id, failError);
    }
  }
  // Any other event type: acknowledged (already recorded in the ledger above), no action needed.

  return new Response("ok", { status: 200 });
});