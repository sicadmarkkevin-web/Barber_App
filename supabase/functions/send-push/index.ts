// supabase/functions/send-push/index.ts
//
// Phase 3 of notifications: delivers a Web Push notification for a single
// already-created notification row to every device the owning barber has
// registered. Triggered by a pg_net call from the notifications table's
// AFTER INSERT trigger (see 0024) — not called by any user directly, and
// not a replacement for the existing Realtime in-app notification, which
// keeps working exactly as before. Push is an additional delivery channel.
//
// Required secrets (set via `supabase secrets set`, never in frontend code):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a mailto: or https:
//   URL identifying the sender, required by the Web Push spec)
// Also uses the automatic SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY every
// Edge Function already has — no separate configuration for those.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let notificationId: string | undefined;
  try {
    const body = await req.json();
    notificationId = body?.notification_id;
  } catch {
    return jsonResponse({ error: "Invalid payload" }, 400);
  }
  if (!notificationId) return jsonResponse({ error: "Missing notification_id" }, 400);

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("send-push: VAPID secrets not configured");
    return jsonResponse({ error: "Push not configured" }, 500);
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // The exact notification that was just created — never anything cached or
  // assumed from a prior request. This is what guarantees the same
  // "one booking, one customer, no bleed-over" guarantee already relied on
  // elsewhere in this project.
  const { data: notification, error: notifError } = await supabase
    .from("notifications")
    .select("id, recipient_type, recipient_id, type, payload")
    .eq("id", notificationId)
    .maybeSingle();

  if (notifError || !notification || notification.recipient_type !== "barber") {
    console.error("send-push: notification lookup failed:", notifError);
    return jsonResponse({ ok: true }); // nothing to push — not an error worth retrying
  }

  const { data: subscriptions, error: subError } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("barber_id", notification.recipient_id);

  if (subError) {
    console.error("send-push: subscription lookup failed:", subError);
    return jsonResponse({ error: "Lookup failed" }, 500);
  }
  if (!subscriptions || subscriptions.length === 0) {
    return jsonResponse({ ok: true, sent: 0 });
  }

  const p = notification.payload || {};
  const title = notification.type === "new_booking" ? "New booking received" : "Notification";
  const bodyLines = [
    p.customer_name && p.service_name ? `${p.customer_name} booked ${p.service_name}` : null,
    p.date ? `${p.date}${p.start_time ? " · " + p.start_time : ""}` : null,
  ].filter(Boolean);
  const pushPayload = JSON.stringify({
    title,
    body: bodyLines.join("\n"),
    data: {
      bookingId: p.booking_id || null,
      url: p.booking_id ? `/dashboard/appointments?highlight=${p.booking_id}` : "/dashboard",
    },
  });

  let sent = 0;
  const expiredIds: string[] = [];

  // Each device is independent — one invalid/expired subscription must
  // never prevent delivery to the others.
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          pushPayload
        );
        sent++;
      } catch (err: any) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Push service confirms this subscription is gone for good.
          expiredIds.push(sub.id);
        } else {
          console.error("send-push: delivery failed for subscription", sub.id, statusCode, err?.body || err);
        }
      }
    })
  );

  if (expiredIds.length > 0) {
    const { error: deleteError } = await supabase.from("push_subscriptions").delete().in("id", expiredIds);
    if (deleteError) {
      console.error("send-push: failed to clean up expired subscriptions:", deleteError);
    }
  }

  return jsonResponse({ ok: true, sent, expired: expiredIds.length });
});