import { supabase } from "../lib/supabaseClient";
import { validateUsernameFormat } from "../utils/username";

/** Public lookup used by the /:username page. Returns null on no match (→ 404), not an error. */
export async function getBarberByUsername(username) {
  const { data, error } = await supabase
    .from("barbers")
    .select(
      "id, username, shop_name, tagline, bio, profile_image_url, cover_image_url, phone, location, location_lat, location_lng, facebook_url, instagram_url, tiktok_url, messenger_url, website_url, timezone, plan, account_type, booking_settings, paymongo_connected"
    )
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Checks format + DB uniqueness together. Used live in the onboarding username step,
 * and again (fresh) right before the barbers row is created.
 *
 * Throws on a real Supabase/network error — it does NOT swallow errors into
 * `{ available: false }`, because "the query failed" and "the name is taken"
 * are different situations and the caller needs to be able to tell them apart.
 */
export async function checkUsernameAvailable(raw) {
  const format = validateUsernameFormat(raw);
  if (!format.ok) return { available: false, reason: format.reason };

  console.log("Checking username:", format.username);

  const { data, error } = await supabase
    .from("barbers")
    .select("id")
    .eq("username", format.username)
    .maybeSingle();

  console.log("Username availability result:", { data, error });

  if (error) {
    console.error("Username availability Supabase error:", error);
    throw error;
  }

  return { available: !data, username: format.username };
}

/** The row for the currently authenticated barber, or null if they haven't finished onboarding. */
export async function getMyBarberProfile() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("barbers")
    .select("*")
    .eq("owner_profile_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Creates the barbers row for the signed-in user. Called once, at the end of onboarding. */
export async function createBarberProfile(payload) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const format = validateUsernameFormat(payload.username);
  if (!format.ok) throw new Error(format.reason);

  const { data, error } = await supabase
    .from("barbers")
    .insert({ ...payload, username: format.username, owner_profile_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyBarberProfile(barberId, patch) {
  const { data, error } = await supabase
    .from("barbers")
    .update(patch)
    .eq("id", barberId)
    .select()
    .single();
  if (error) throw error;
  return data;
}