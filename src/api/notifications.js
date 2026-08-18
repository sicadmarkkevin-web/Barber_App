import { supabase } from "../lib/supabaseClient";

// Matches the notifications table as it actually exists in the database —
// recipient_type/recipient_id/payload (jsonb), not the flat barber_id/
// booking_id/title/message shape originally designed. See 0023's comment
// for why.
const SELECT_FIELDS = "id, recipient_type, recipient_id, type, payload, is_read, created_at";

/** Newest first — the only writer is create_booking (server-side), so this
 * is purely a read. RLS already scopes this to the caller's own barber. */
export async function listNotifications(barberId, limit = 50) {
  const { data, error } = await supabase
    .from("notifications")
    .select(SELECT_FIELDS)
    .eq("recipient_type", "barber")
    .eq("recipient_id", barberId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listNotifications failed:", error);
    throw error;
  }
  return data;
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  if (error) {
    console.error("markNotificationRead failed:", error);
    throw error;
  }
}

export async function markAllNotificationsRead(barberId) {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("recipient_type", "barber")
    .eq("recipient_id", barberId)
    .eq("is_read", false);
  if (error) {
    console.error("markAllNotificationsRead failed:", error);
    throw error;
  }
}

/**
 * Subscribes to new notifications for exactly one barber. Returns an
 * unsubscribe function — the caller (DashboardLayout) is responsible for
 * calling it on unmount so there is never more than one active channel per
 * session, per the "avoid duplicate subscriptions" requirement.
 */
export function subscribeToNotifications(barberId, onInsert) {
  const channel = supabase
    .channel(`notifications:${barberId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${barberId}` },
      (payload) => {
        // The realtime filter can only match recipient_id (a single equality
        // check) — recipient_type is checked here too, defensively, in case
        // a customer-type row ever shares the same uuid as a barber's id.
        if (payload.new.recipient_type !== "barber") return;
        onInsert(payload.new);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}