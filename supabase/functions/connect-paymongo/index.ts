// supabase/functions/connect-paymongo/index.ts
//
// Phase 3 extends Phase 2's "paste your PayMongo secret key" flow: now that
// webhooks exist, connecting also registers a webhook endpoint on THIS
// business's own PayMongo account (pointing at our single shared
// paymongo-webhook function) and stores the secret PayMongo returns for it.
// Storing the business's own secret key itself is unchanged from Phase 2 —
// reused via the existing set_paymongo_secret_key RPC, not rebuilt.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const GENERIC_ERROR = "Couldn't connect PayMongo. Please check your secret key and try again.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: GENERIC_ERROR }, 405);

  let barberId: string | undefined;
  let secretKey: string | undefined;
  try {
    const body = await req.json();
    barberId = body?.barberId;
    secretKey = body?.secretKey;
  } catch {
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }
  if (!barberId || !secretKey) {
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Please sign in again and retry." }, 401);
  }

  // User-scoped client (carries the caller's own JWT) — reused RPCs below
  // enforce ownership themselves via auth.uid(), exactly as they did in
  // Phase 2. No separate ownership check needed here.
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { error: saveKeyError } = await userClient.rpc("set_paymongo_secret_key", {
    p_barber_id: barberId,
    p_secret_key: secretKey,
  });
  if (saveKeyError) {
    console.error("connect-paymongo: set_paymongo_secret_key failed:", saveKeyError);
    return jsonResponse({ error: saveKeyError.message || GENERIC_ERROR }, 400);
  }

  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/paymongo-webhook`;

  let webhookId: string;
  let webhookSecret: string;
  try {
    const resp = await fetch("https://api.paymongo.com/v1/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(secretKey + ":"),
      },
      body: JSON.stringify({
        data: { attributes: { url: webhookUrl, events: ["checkout_session.payment.paid", "payment.failed"] } },
      }),
    });
    const payload = await resp.json();
    if (!resp.ok) {
      console.error("connect-paymongo: PayMongo webhook registration failed:", JSON.stringify(payload));
      return jsonResponse({ error: "Connected your key, but couldn't register the webhook. Please try again." }, 502);
    }
    webhookId = payload.data.id;
    webhookSecret = payload.data.attributes.secret_key;
  } catch (err) {
    console.error("connect-paymongo: webhook registration request failed:", err);
    return jsonResponse({ error: "Connected your key, but couldn't register the webhook. Please try again." }, 502);
  }

  const { error: saveWebhookError } = await userClient.rpc("set_paymongo_webhook_secret", {
    p_barber_id: barberId,
    p_webhook_secret: webhookSecret,
    p_webhook_id: webhookId,
  });
  if (saveWebhookError) {
    console.error("connect-paymongo: set_paymongo_webhook_secret failed:", saveWebhookError);
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }

  return jsonResponse({ success: true });
});