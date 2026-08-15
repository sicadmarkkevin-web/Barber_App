// supabase/functions/disconnect-paymongo/index.ts
//
// Disables the business's webhook on PayMongo's own side (best-effort —
// still proceeds with local disconnect even if this fails, since a
// barber's ability to turn off online payments shouldn't depend on
// PayMongo's API being reachable), then wipes local secrets via the
// existing disconnect_paymongo RPC (0017, extended in 0018) — not rebuilt.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Couldn't disconnect PayMongo. Please try again." }, 405);

  let barberId: string | undefined;
  try {
    const body = await req.json();
    barberId = body?.barberId;
  } catch {
    return jsonResponse({ error: "Couldn't disconnect PayMongo. Please try again." }, 400);
  }
  const authHeader = req.headers.get("Authorization");
  if (!barberId || !authHeader) {
    return jsonResponse({ error: "Couldn't disconnect PayMongo. Please try again." }, 400);
  }

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Best-effort: disable the webhook on PayMongo's side first, using the
  // key that's about to be removed. If either lookup or the API call fails,
  // log it and continue — the local disconnect below must not be blocked by
  // PayMongo being unreachable.
  try {
    const { data: barber } = await serviceClient.from("barbers").select("paymongo_webhook_id").eq("id", barberId).maybeSingle();
    const { data: secretKey } = await serviceClient.rpc("get_paymongo_secret_key", { p_barber_id: barberId });
    if (barber?.paymongo_webhook_id && secretKey) {
      const resp = await fetch(`https://api.paymongo.com/v1/webhooks/${barber.paymongo_webhook_id}/disable`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(secretKey + ":") },
      });
      if (!resp.ok) {
        console.error("disconnect-paymongo: PayMongo webhook disable returned", resp.status);
      }
    }
  } catch (err) {
    console.error("disconnect-paymongo: webhook disable step failed (continuing anyway):", err);
  }

  const { error } = await userClient.rpc("disconnect_paymongo", { p_barber_id: barberId });
  if (error) {
    console.error("disconnect-paymongo: disconnect_paymongo RPC failed:", error);
    return jsonResponse({ error: error.message || "Couldn't disconnect PayMongo. Please try again." }, 400);
  }

  return jsonResponse({ success: true });
});