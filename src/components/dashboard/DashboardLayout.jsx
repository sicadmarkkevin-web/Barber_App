import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { signOut } from "../../api/auth";
import { listNotifications, markNotificationRead, markAllNotificationsRead, subscribeToNotifications } from "../../api/notifications";
import Sidebar from "./Sidebar";
import MobileDashboardNav from "./MobileDashboardNav";

export default function DashboardLayout() {
  const { barber } = useAuth();
  const navigate = useNavigate();

  // Owned here (not in Sidebar/MobileDashboardNav individually) so there is
  // exactly one fetch and one realtime subscription for the whole dashboard
  // session, regardless of which internal page is open or how many times
  // the person navigates around — DashboardLayout only mounts once.
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (!barber) return;
    let active = true;
    listNotifications(barber.id)
      .then((data) => active && setNotifications(data))
      .catch(() => {
        // Notifications failing to load must never block the dashboard
        // itself — it just shows an empty bell until the next successful
        // fetch or realtime event.
      });

    const unsubscribe = subscribeToNotifications(barber.id, (newNotification) => {
      setNotifications((prev) => {
        // Guard against the same notification arriving twice (e.g. a
        // realtime event plus an overlapping manual refresh).
        if (prev.some((n) => n.id === newNotification.id)) return prev;
        return [newNotification, ...prev];
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [barber?.id]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function handleOpenNotification(notification) {
    if (!notification.is_read) {
      setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n)));
      try {
        await markNotificationRead(notification.id);
      } catch {
        // UI already reflects "read" — a failed background sync isn't worth
        // interrupting the owner over; it'll self-correct on next load.
      }
    }
    const bookingId = notification.payload?.booking_id;
    if (bookingId) {
      navigate(`/dashboard/appointments?highlight=${bookingId}`);
    }
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    if (barber) {
      try {
        await markAllNotificationsRead(barber.id);
      } catch {
        // Same reasoning as above — optimistic UI, background sync.
      }
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="dash-shell">
      <Sidebar
        barber={barber}
        onSignOut={handleSignOut}
        notifications={notifications}
        unreadCount={unreadCount}
        onOpenNotification={handleOpenNotification}
        onMarkAllRead={handleMarkAllRead}
      />
      <MobileDashboardNav
        barber={barber}
        onSignOut={handleSignOut}
        notifications={notifications}
        unreadCount={unreadCount}
        onOpenNotification={handleOpenNotification}
        onMarkAllRead={handleMarkAllRead}
      />
      <div className="dash-main">
        <Outlet />
      </div>
    </div>
  );
}