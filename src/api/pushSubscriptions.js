import { supabase } from "../lib/supabaseClient";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** "unsupported" | "default" | "granted" | "denied" */
export function getPushPermissionState() {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/** Whether THIS browser/device already has an active push subscription —
 * used to show "enabled" state correctly per-device, since a barber may
 * have notifications on for their phone but not their laptop. */
export async function getCurrentDeviceSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Requests permission (only called from a user action — the "Enable
 * notifications" button click, never automatically), registers the service
 * worker, creates a Push subscription, and upserts it for this barber.
 * Upsert on `endpoint` means re-enabling on the same device/browser updates
 * the existing row instead of creating a duplicate (Step 14).
 */
export async function enablePushNotifications(barberId) {
  if (!isPushSupported()) {
    throw new Error("Push notifications aren't supported in this browser.");
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error("Push notifications aren't configured yet.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. You can re-enable them in your browser's site settings."
        : "Notification permission wasn't granted."
    );
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      barber_id: barberId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );
  if (error) {
    console.error("enablePushNotifications: failed to save subscription:", error);
    throw new Error("Couldn't save your notification settings. Please try again.");
  }

  return subscription;
}

/** Unsubscribes this device only — other devices' subscriptions (per Step 7)
 * are untouched. */
export async function disablePushNotifications() {
  const subscription = await getCurrentDeviceSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  try {
    await subscription.unsubscribe();
  } catch (err) {
    console.error("disablePushNotifications: browser unsubscribe failed:", err);
    // Still try to remove the DB row below — a stale row pointing at an
    // already-unsubscribed endpoint would just fail silently on send anyway,
    // but cleaning it up now avoids that.
  }

  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) {
    console.error("disablePushNotifications: failed to remove subscription row:", error);
  }
}