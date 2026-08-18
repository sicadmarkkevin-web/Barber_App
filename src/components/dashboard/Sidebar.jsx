import { useState } from "react";
import { NavLink } from "react-router-dom";
import { ExternalLink, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_ITEMS } from "./navItems";
import NotificationBell from "./NotificationBell";

const COLLAPSE_KEY = "alora_sidebar_collapsed";

export default function Sidebar({ barber, onSignOut, notifications, unreadCount, onOpenNotification, onMarkAllRead }) {
  const items = NAV_ITEMS.filter((item) => !item.shopOnly || barber?.account_type === "shop");
  const bookingLink = `${window.location.origin}/${barber?.username}`;

  // Desktop-only affordance (this sidebar isn't even rendered visually below
  // 900px — see .dash-sidebar's base `display: none`) — purely a layout
  // preference, so persisting it in localStorage is fine here.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Storage unavailable (e.g. private browsing) — the toggle still
        // works for this session, it just won't be remembered next visit.
      }
      return next;
    });
  }

  return (
    <aside className={`dash-sidebar${collapsed ? " dash-sidebar-collapsed" : ""}`}>
      <div className="dash-sidebar-top">
        {!collapsed && <div className="dash-sidebar-brand">ALORA</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            onOpenNotification={onOpenNotification}
            onMarkAllRead={onMarkAllRead}
          />
          <button
            type="button"
            className="dash-sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
      </div>

      <nav className="dash-sidebar-nav">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `dash-nav-link${isActive ? " active" : ""}`}
            title={collapsed ? label : undefined}
          >
            <Icon size={17} />
            <span className="dash-nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="dash-sidebar-footer">
        <a
          href={bookingLink}
          target="_blank"
          rel="noreferrer"
          className="dash-nav-link"
          title={collapsed ? "View booking page" : undefined}
        >
          <ExternalLink size={17} />
          <span className="dash-nav-label">View booking page</span>
        </a>
        <button
          type="button"
          className="dash-nav-link dash-nav-link-btn"
          onClick={onSignOut}
          title={collapsed ? "Sign out" : undefined}
        >
          <LogOut size={17} />
          <span className="dash-nav-label">Sign out</span>
        </button>
      </div>
    </aside>
  );
}