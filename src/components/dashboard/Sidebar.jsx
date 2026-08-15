import { NavLink } from "react-router-dom";
import { ExternalLink, LogOut } from "lucide-react";
import { NAV_ITEMS } from "./navItems";

export default function Sidebar({ barber, onSignOut }) {
  const items = NAV_ITEMS.filter((item) => !item.shopOnly || barber?.account_type === "shop");
  const bookingLink = `${window.location.origin}/${barber?.username}`;

  return (
    <aside className="dash-sidebar">
      <div className="dash-sidebar-brand">ALORA</div>

      <nav className="dash-sidebar-nav">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `dash-nav-link${isActive ? " active" : ""}`}>
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="dash-sidebar-footer">
        <a href={bookingLink} target="_blank" rel="noreferrer" className="dash-nav-link">
          <ExternalLink size={17} />
          View booking page
        </a>
        <button type="button" className="dash-nav-link dash-nav-link-btn" onClick={onSignOut}>
          <LogOut size={17} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
