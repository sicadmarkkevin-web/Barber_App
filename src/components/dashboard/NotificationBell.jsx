import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { formatFriendlyDate, formatTime12h } from "../../utils/time";

// The notifications table stores everything booking-specific inside a
// jsonb `payload` column (recipient_type/recipient_id/type/payload), not as
// flat columns — see 0023's migration comment for why. There's no stored
// title/message text either, so it's derived here from `type`.
const TYPE_TITLES = {
  new_booking: "New booking received",
};

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function NotificationBell({ notifications, unreadCount, onOpenNotification, onMarkAllRead }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-bell-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
      >
        <Bell size={19} />
        {unreadCount > 0 && <span className="notif-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-head">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button type="button" className="notif-mark-all" onClick={onMarkAllRead}>
                Mark all as read
              </button>
            )}
          </div>

          <div className="notif-list">
            {notifications.length === 0 ? (
              <p className="hint-text" style={{ padding: "16px 14px" }}>
                No notifications yet.
              </p>
            ) : (
              notifications.map((n) => {
                const p = n.payload || {};
                const title = TYPE_TITLES[n.type] || "Notification";
                return (
                  <button
                    type="button"
                    key={n.id}
                    className={`notif-item${n.is_read ? "" : " notif-item-unread"}`}
                    onClick={() => {
                      setOpen(false);
                      onOpenNotification(n);
                    }}
                  >
                    <div className="notif-item-title">
                      {!n.is_read && <span className="notif-dot" />}
                      {title}
                    </div>
                    {(p.customer_name || p.service_name) && (
                      <div className="notif-item-body">
                        {p.customer_name && <strong>{p.customer_name}</strong>}
                        {p.customer_name && p.service_name && " · "}
                        {p.service_name}
                      </div>
                    )}
                    {p.date && (
                      <div className="notif-item-meta">
                        {formatFriendlyDate(p.date)} · {formatTime12h(p.start_time)}
                      </div>
                    )}
                    <div className="notif-item-footer">
                      <span>{p.booking_reference ? `Reference: ${p.booking_reference}` : ""}</span>
                      <span>{timeAgo(n.created_at)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}