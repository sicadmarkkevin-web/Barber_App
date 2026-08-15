import { supabase } from "../lib/supabaseClient";

/**
 * Connects the barber's OWN PayMongo account: stores their secret key
 * (Supabase Vault, unchanged from Phase 2) AND registers a webhook endpoint
 * on their PayMongo account so payment confirmations can reach us (new in
 * Phase 3). Both steps happen server-side in the connect-paymongo Edge
 * Function — this never sees the webhook secret PayMongo returns.
 */
export async function setPaymongoSecretKey(barberId, secretKey) {
  const { data, error } = await supabase.functions.invoke("connect-paymongo", {
    body: { barberId, secretKey },
  });
  if (error) {
    console.error("setPaymongoSecretKey failed:", error);
    throw new Error(data?.error || "Couldn't connect PayMongo. Please try again.");
  }
  if (data?.error) {
    throw new Error(data.error);
  }
}

/** Disables the webhook on PayMongo's own side, then clears the stored
 * secret key and webhook secret locally (both via disconnect-paymongo). */
export async function disconnectPaymongo(barberId) {
  const { data, error } = await supabase.functions.invoke("disconnect-paymongo", {
    body: { barberId },
  });
  if (error) {
    console.error("disconnectPaymongo failed:", error);
    throw new Error(data?.error || "Couldn't disconnect PayMongo. Please try again.");
  }
  if (data?.error) {
    throw new Error(data.error);
  }
}