// public/sw.js
//
// Minimal service worker, scoped to exactly what Web Push needs: receive a
// push event while the app isn't open, show a notification, and route a
// tap back into the app at the right booking. Not a full PWA/offline-cache
// setup — that's out of scope for this feature.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "New booking received";
  const options = {
    body: data.body || "",
    data: { url: (data.data && data.data.url) || "/dashboard" },
    tag: (data.data && data.data.bookingId) || undefined, // replaces a stale notification for the same booking rather than stacking duplicates
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});