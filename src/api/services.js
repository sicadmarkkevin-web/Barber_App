import { supabase } from "../lib/supabaseClient";

const SELECT_FIELDS = "id, barber_id, name, price, duration_minutes, has_styles, active, sort_order";

/** All of a barber's services (owner view — dashboard). Ordered by the existing sort_order column. */
export async function listServicesForBarber(barberId) {
  const { data, error } = await supabase
    .from("services")
    .select(SELECT_FIELDS)
    .eq("barber_id", barberId)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("listServicesForBarber failed:", error);
    throw error;
  }
  return data;
}

/** Public view — only active services, for the /:username page. */
export async function listActiveServicesForBarber(barberId) {
  const { data, error } = await supabase
    .from("services")
    .select(SELECT_FIELDS)
    .eq("barber_id", barberId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("listActiveServicesForBarber failed:", error);
    throw error;
  }
  return data;
}

/** Appends a new service after the barber's current last one, using the existing sort_order column. */
export async function createService(barberId, { name, price, durationMinutes, hasStyles }) {
  const { data: last, error: lastError } = await supabase
    .from("services")
    .select("sort_order")
    .eq("barber_id", barberId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (lastError) {
    console.error("createService (reading sort_order) failed:", lastError);
    throw lastError;
  }
  const nextOrder = last?.length ? last[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from("services")
    .insert({
      barber_id: barberId,
      name,
      price,
      duration_minutes: durationMinutes,
      has_styles: hasStyles,
      sort_order: nextOrder,
    })
    .select(SELECT_FIELDS)
    .single();
  if (error) {
    console.error("createService failed:", error);
    throw error;
  }
  return data;
}

export async function updateService(id, { name, price, durationMinutes, hasStyles }) {
  const { data, error } = await supabase
    .from("services")
    .update({ name, price, duration_minutes: durationMinutes, has_styles: hasStyles })
    .eq("id", id)
    .select(SELECT_FIELDS)
    .single();
  if (error) {
    console.error("updateService failed:", error);
    throw error;
  }
  return data;
}

export async function deleteService(id) {
  const { error } = await supabase.from("services").delete().eq("id", id);
  if (error) {
    console.error("deleteService failed:", error);
    throw error;
  }
}
