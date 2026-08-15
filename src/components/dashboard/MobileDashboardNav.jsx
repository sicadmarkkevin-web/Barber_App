import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Menu, X, ExternalLink, LogOut } from "lucide-react";
import { NAV_ITEMS } from "./navItems";

export default function MobileDashboardNav({ barber, onSignOut }) {
  const [open, setOpen] = useState(false);
  const items = NAV_ITEMS.filter((item) => !item.shopOnly || barber?.account_type === "shop");
  const bookingLink = `${window.location.origin}/${barber?.username}`;

  return (
    <>
      <div className="dash-mobile-header">
        <span className="dash-mobile-brand">ALORA</span>
        <button type="button" className="icon-btn" aria-label="Open menu" onClick={() => setOpen(true)}>
          <Menu size={20} />
        </button>
      </div>

      {open && (
        <div className="overlay-backdrop" onClick={() => setOpen(false)}>
          <div className="dash-mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span className="dash-mobile-brand">ALORA</span>
              <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `dash-nav-link${isActive ? " active" : ""}`}
                >
                  <Icon size={17} />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="dash-sidebar-footer" style={{ marginTop: 14, paddingTop: 14 }}>
              <a href={bookingLink} target="_blank" rel="noreferrer" className="dash-nav-link" onClick={() => setOpen(false)}>
                <ExternalLink size={17} />
                View booking page
              </a>
              <button
                type="button"
                className="dash-nav-link dash-nav-link-btn"
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
              >
                <LogOut size={17} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
