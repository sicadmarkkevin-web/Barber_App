import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, MapPin, Phone, Facebook, Instagram, MessageCircle, Globe } from "lucide-react";
import { getBarberByUsername } from "../../api/barbers";
import { listActiveServicesForBarber } from "../../api/services";
import { listStylesForBarber } from "../../api/styles";
import { getWeeklyHours } from "../../api/hours";
import { formatPHP } from "../../utils/currency";
import { formatTime12h } from "../../utils/time";
import HairIcon from "../../components/shared/HairIcon";
import NotFound from "../NotFound";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/shared/Toast";

function TikTokIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.6 5.8c-.9-.9-1.4-2.1-1.5-3.5h-3.2v13.3c0 1.5-1.2 2.7-2.7 2.7s-2.7-1.2-2.7-2.7 1.2-2.7 2.7-2.7c.3 0 .6.1.9.2V9.9c-.3 0-.6-.1-.9-.1-3.2 0-5.9 2.6-5.9 5.9s2.6 5.9 5.9 5.9 5.9-2.6 5.9-5.9V9c1.2.9 2.7 1.4 4.3 1.4V7.2c-1 0-1.9-.3-2.8-.9z" />
    </svg>
  );
}

const SOCIAL_LINKS = [
  ["facebook_url", Facebook, "Facebook"],
  ["instagram_url", Instagram, "Instagram"],
  ["tiktok_url", TikTokIcon, "TikTok"],
  ["messenger_url", MessageCircle, "Messenger"],
  ["website_url", Globe, "Website"],
];

export default function BarberPage() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [barber, setBarber] = useState(undefined); // undefined = loading, null = not found
  const [error, setError] = useState("");
  const [services, setServices] = useState(null); // null = loading
  const [styles, setStyles] = useState(null); // null = loading
  const [hours, setHours] = useState(null); // null = loading
  const { toast, showToast } = useToast();

  useEffect(() => {
    let active = true;
    setBarber(undefined);
    getBarberByUsername(username)
      .then((data) => active && setBarber(data))
      .catch((err) => active && setError(err.message || "Something went wrong."));
    return () => {
      active = false;
    };
  }, [username]);

  useEffect(() => {
    if (!barber) return;
    let active = true;
    setServices(null);
    listActiveServicesForBarber(barber.id)
      .then((data) => active && setServices(data))
      .catch(() => active && setServices([])); // fail quiet on the public page — services just won't show
    return () => {
      active = false;
    };
  }, [barber]);

  useEffect(() => {
    if (!barber) return;
    let active = true;
    setStyles(null);
    listStylesForBarber(barber.id)
      .then((data) => active && setStyles(data))
      .catch(() => active && setStyles([])); // fail quiet — styles just won't show
    return () => {
      active = false;
    };
  }, [barber]);

  useEffect(() => {
    if (!barber) return;
    let active = true;
    setHours(null);
    getWeeklyHours(barber.id)
      .then((data) => active && setHours(data))
      .catch(() => active && setHours([])); // fail quiet — hours just won't show
    return () => {
      active = false;
    };
  }, [barber]);

  if (error) {
    return (
      <div className="center-screen">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (barber === undefined) {
    return (
      <div className="center-screen">
        <Loader2 className="spinner" size={22} color="var(--brass)" />
      </div>
    );
  }

  if (barber === null) return <NotFound />;

  const activeSocials = SOCIAL_LINKS.filter(([field]) => barber[field]);

  return (
    <div className="app-shell">
      <div className="container" style={{ paddingTop: 40, paddingBottom: 40 }}>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              margin: "0 auto",
              background: "var(--surface-raised)",
              border: "2px solid var(--brass)",
              backgroundImage: barber.profile_image_url ? `url(${barber.profile_image_url})` : "none",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <h1 style={{ fontSize: 26, marginTop: 16 }}>{barber.shop_name}</h1>
          {barber.tagline && <p style={{ marginTop: 6 }}>{barber.tagline}</p>}
          {barber.location && (
            <p style={{ marginTop: 4, display: "flex", justifyContent: "center", gap: 6, fontSize: 13.5 }}>
              <MapPin size={14} /> {barber.location}
            </p>
          )}
        </div>

        {barber.bio && (
          <div className="card" style={{ marginTop: 24 }}>
            <p style={{ margin: 0, color: "var(--ink)" }}>{barber.bio}</p>
          </div>
        )}

        {barber.phone && (
          <p style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14 }}>
            <Phone size={14} /> {barber.phone}
          </p>
        )}

        {activeSocials.length > 0 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 14 }}>
            {activeSocials.map(([field, Icon, label]) => (
              <a
                key={field}
                href={barber[field]}
                target="_blank"
                rel="noreferrer"
                title={label}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  color: "var(--brass)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon size={16} />
              </a>
            ))}
          </div>
        )}

        <div className="card" style={{ marginTop: 20 }}>
          <div className="eyebrow">Services</div>
          {services === null && (
            <p style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, marginBottom: 0 }}>
              <Loader2 className="spinner" size={14} /> Loading…
            </p>
          )}
          {services && services.length === 0 && (
            <p style={{ marginTop: 10, marginBottom: 0 }}>No services added yet.</p>
          )}
          {services && services.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {services.map((s) => (
                <div key={s.id} className="service-row" style={{ alignItems: "baseline" }}>
                  <div>
                    <div style={{ color: "var(--ink)", fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: 12.5, marginTop: 2 }}>{s.duration_minutes} min</div>
                  </div>
                  <div style={{ color: "var(--brass)", fontWeight: 600 }}>{formatPHP(s.price)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ marginTop: 20 }}>
          <div className="eyebrow">Our styles</div>
          {styles === null && (
            <p style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, marginBottom: 0 }}>
              <Loader2 className="spinner" size={14} /> Loading…
            </p>
          )}
          {styles && styles.length === 0 && (
            <p style={{ marginTop: 10, marginBottom: 0 }}>No styles added yet.</p>
          )}
          {styles && styles.length > 0 && (
            <div className="style-grid" style={{ marginTop: 10 }}>
              {styles.map((s) => (
                <div className="style-card" key={s.id}>
                  <div className="style-thumb" style={s.image_url ? { backgroundImage: `url(${s.image_url})` } : undefined}>
                    {!s.image_url && <HairIcon type={s.icon || "fade"} size={34} />}
                  </div>
                  <div className="style-name" style={{ paddingBottom: 10 }}>{s.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ marginTop: 20 }}>
          <div className="eyebrow">Business hours</div>
          {hours === null && (
            <p style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, marginBottom: 0 }}>
              <Loader2 className="spinner" size={14} /> Loading…
            </p>
          )}
          {hours && hours.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {hours.map((d) => (
                <div key={d.day_of_week} className="service-row">
                  <span style={{ color: "var(--ink)" }}>{d.label}</span>
                  <span>{d.is_closed ? "Closed" : `${formatTime12h(d.open_time)} – ${formatTime12h(d.close_time)}`}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Spacer so the last card isn't hidden behind the fixed bar below. */}
        <div className="floating-cta-spacer" />

        <Toast toast={toast} />
      </div>

      <div className="floating-cta-bar">
        <div className="container">
          <button className="btn btn-primary" onClick={() => navigate(`/${username}/book`)}>
            Book an appointment
          </button>
        </div>
      </div>
    </div>
  );
}