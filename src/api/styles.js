import { supabase } from "../lib/supabaseClient";

const SELECT_FIELDS = "id, barber_id, name, icon, image_url, sort_order";

/** Used by both the dashboard (owner) and the public page — hair_styles has no
 * active/inactive flag (unlike services), so there's just one list function. */
export async function listStylesForBarber(barberId) {
  const { data, error } = await supabase
    .from("hair_styles")
    .select(SELECT_FIELDS)
    .eq("barber_id", barberId)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("listStylesForBarber failed:", error);
    throw error;
  }
  return data;
}

/**
 * Creates a style with a client-generated id (crypto.randomUUID()) rather than
 * letting the database default assign one, so the image (if any) can be
 * uploaded to its final `{barber_id}/{style_id}.jpg` storage path in the same
 * form submission, before the row exists.
 */
export async function createStyle(barberId, { id, name, icon, imageUrl }) {
  const { data: last, error: lastError } = await supabase
    .from("hair_styles")
    .select("sort_order")
    .eq("barber_id", barberId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (lastError) {
    console.error("createStyle (reading sort_order) failed:", lastError);
    throw lastError;
  }
  const nextOrder = last?.length ? last[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from("hair_styles")
    .insert({ id, barber_id: barberId, name, icon, image_url: imageUrl, sort_order: nextOrder })
    .select(SELECT_FIELDS)
    .single();
  if (error) {
    console.error("createStyle failed:", error);
    throw error;
  }
  return data;
}

export async function updateStyle(id, { name, icon, imageUrl }) {
  const { data, error } = await supabase
    .from("hair_styles")
    .update({ name, icon, image_url: imageUrl })
    .eq("id", id)
    .select(SELECT_FIELDS)
    .single();
  if (error) {
    console.error("updateStyle failed:", error);
    throw error;
  }
  return data;
}

export async function deleteStyle(id) {
  const { error } = await supabase.from("hair_styles").delete().eq("id", id);
  if (error) {
    console.error("deleteStyle failed:", error);
    throw error;
  }
}

/** Best-effort image cleanup — called before deleteStyle when the style has a photo. */
export async function deleteStyleImage(barberId, styleId) {
  const { error } = await supabase.storage.from("style-images").remove([`${barberId}/${styleId}.jpg`]);
  if (error) {
    // Non-fatal: don't block the row delete over an orphaned storage file.
    console.error("deleteStyleImage failed (continuing anyway):", error);
  }
}
