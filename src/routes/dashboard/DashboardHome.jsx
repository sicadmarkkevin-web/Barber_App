import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Copy,
  Check,
  ExternalLink,
  User,
  Scissors,
  Images,
  Clock,
  SlidersHorizontal,
  Users,
  CalendarClock,
  CalendarX,
  Camera,
  Loader2,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { listBookingsForBarber } from "../../api/appointments";
import { listServicesForBarber } from "../../api/services";
import { listStaffForBarber } from "../../api/staff";
import { hasSavedBusinessHours } from "../../api/hours";
import { formatPHP } from "../../utils/currency";
import { formatTime12h, todayLocalISO, currentWeekRangeISO, currentMonthRangeISO, currentYearRangeISO } from "../../utils/time";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/shared/Toast";
import StatCard from "../../components/dashboard/StatCard";
import EmptyState from "../../components/dashboard/EmptyState";
import ManagementCard from "../../components/dashboard/ManagementCard";
import IncomeCard from "../../components/dashboard/IncomeCard";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardHome() {
  const { barber, user } = useAuth();
  const { toast, showToast } = useToast();

  const [bookings, setBookings] = useState(null); // null = loading
  const [servicesCount, setServicesCount] = useState(null);
  const [staff, setStaff] = useState(null); // null = loading/not fetched (solo accounts stay null)
  const [savedHours, setSavedHours] = useState(null);
  const [copied, setCopied] = useState(false);
  const [incomePeriod, setIncomePeriod] = useState("day");

  useEffect(() => {
    if (!barber) return;
    let active = true;

    listBookingsForBarber(barber.id)
      .then((data) => active && setBookings(data))
      .catch(() => active && setBookings([]));

    listServicesForBarber(barber.id)
      .then((data) => active && setServicesCount(data.length))
      .catch(() => active && setServicesCount(0));

    hasSavedBusinessHours(barber.id)
      .then((v) => active && setSavedHours(v))
      .catch(() => active && setSavedHours(false));

    if (barber.account_type === "shop") {
      listStaffForBarber(barber.id)
        .then((data) => active && setStaff(data))
        .catch(() => active && setStaff([]));
    }

    return () => {
      active = false;
    };
  }, [barber]);

  const today = todayLocalISO();
  const { start: weekStart, end: weekEnd } = useMemo(() => currentWeekRangeISO(), []);

  const stats = useMemo(() => {
    if (!bookings) return null;
    const live = bookings.filter((b) => b.status !== "cancelled");
    const todays = live.filter((b) => b.date === today);
    return {
      today: todays.length,
      pending: live.filter((b) => b.status === "pending" && b.date >= today).length,
      confirmedToday: todays.filter((b) => b.status === "confirmed").length,
      thisWeek: live.filter((b) => b.date >= weekStart && b.date <= weekEnd).length,
      todaysList: todays,
    };
  }, [bookings, today, weekStart, weekEnd]);

  // Real income, computed client-side from the bookings already fetched above —
  // no new query needed. Only "completed" appointments count as earned income;
  // pending/confirmed bookings are still just scheduled, not money in hand yet.
  const income = useMemo(() => {
    if (!bookings) return null;
    const ranges = {
      day: { start: today, end: today },
      week: currentWeekRangeISO(),
      month: currentMonthRangeISO(),
      year: currentYearRangeISO(),
    };
    const { start, end } = ranges[incomePeriod];
    const completedInRange = bookings.filter((b) => b.status === "completed" && b.date >= start && b.date <= end);
    return {
      total: completedInRange.reduce((sum, b) => sum + (b.services?.price || 0), 0),
      count: completedInRange.length,
    };
  }, [bookings, incomePeriod, today]);

  const completion = useMemo(() => {
    if (servicesCount === null || savedHours === null || (barber?.account_type === "shop" && staff === null)) return null;
    const items = [
      { key: "photo", label: "Profile photo", done: !!barber?.profile_image_url, to: "/dashboard/profile" },
      { key: "services", label: "Services", done: servicesCount > 0, to: "/dashboard/services" },
      barber?.account_type === "shop"
        ? { key: "team", label: "Team", done: (staff?.length || 0) > 0, to: "/dashboard/staff" }
        : { key: "hours", label: "Business hours", done: savedHours, to: "/dashboard/hours" },
      { key: "website", label: "Website", done: !!barber?.website_url, to: "/dashboard/profile" },
    ];
    const doneCount = items.filter((i) => i.done).length;
    return { items, percent: Math.round((doneCount / items.length) * 100), firstIncomplete: items.find((i) => !i.done) };
  }, [barber, servicesCount, savedHours, staff]);

  const bookingLink = `${window.location.origin}/${barber?.username}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(bookingLink);
    setCopied(true);
    showToast("Link copied.");
    setTimeout(() => setCopied(false), 2000);
  }

  const firstName = user?.user_metadata?.full_name?.trim()?.split(" ")[0] || barber?.shop_name || "there";

  return (
    <div className="container-wide" style={{ paddingTop: 28, paddingBottom: 48 }}>
      {/* ---------- header ---------- */}
      <div className="dash-header">
        <div>
          <h1 className="dash-header-title">
            {greeting()}, {firstName}.
          </h1>
          <p className="dash-header-subtitle">Manage your bookings and barber business from one place.</p>
        </div>
        <div className="dash-header-actions">
          <a href={bookingLink} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ width: "auto", padding: "9px 14px" }}>
            <ExternalLink size={15} /> View booking page
          </a>
          <Link to="/dashboard/profile" className="dash-avatar" aria-label="Edit profile">
            {barber?.profile_image_url ? <img src={barber.profile_image_url} alt="" /> : <User size={18} />}
          </Link>
        </div>
      </div>

      {/* ---------- quick stats ---------- */}
      <div className="stat-grid">
        {stats ? (
          <>
            <StatCard label="Today's appointments" value={stats.today} hint="Upcoming today" icon={CalendarClock} to="/dashboard/appointments?filter=today" />
            <StatCard label="Pending" value={stats.pending} hint="Need your attention" icon={Clock} accent="amber" to="/dashboard/appointments?filter=pending" />
            <StatCard label="Confirmed" value={stats.confirmedToday} hint="Today's confirmed bookings" icon={Check} accent="sage" to="/dashboard/appointments?filter=confirmed" />
            <StatCard label="This week" value={stats.thisWeek} hint="Total appointments" icon={CalendarClock} to="/dashboard/appointments?filter=week" />
          </>
        ) : (
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8, color: "var(--muted)" }}>
            <Loader2 className="spinner" size={16} /> Loading your stats…
          </div>
        )}
      </div>

      {income && (
        <div style={{ marginTop: 16 }}>
          <IncomeCard period={incomePeriod} onPeriodChange={setIncomePeriod} total={income.total} count={income.count} />
        </div>
      )}

      <div className="dash-grid">
        {/* ---------- today's appointments ---------- */}
        <div className="card dash-panel">
          <div className="dash-panel-head">
            <div className="eyebrow">Today's appointments</div>
            <Link to="/dashboard/appointments" className="dash-panel-link">
              View all appointments →
            </Link>
          </div>

          {!stats ? (
            <p style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)" }}>
              <Loader2 className="spinner" size={16} /> Loading…
            </p>
          ) : stats.todaysList.length === 0 ? (
            <EmptyState
              icon={CalendarX}
              title="You're all clear today."
              body="When customers book an appointment, they'll appear here."
            />
          ) : (
            <div>
              {stats.todaysList.map((b) => (
                <div key={b.id} className="today-appt-row">
                  <span className="today-appt-time">{formatTime12h(b.start_time)}</span>
                  <span className="today-appt-body">
                    <div className="today-appt-customer">{b.customers?.name || "Customer"}</div>
                    <div className="today-appt-meta">
                      {b.services?.name} · {formatPHP(b.services?.price)}
                      {b.barber_staff?.name && <> · with {b.barber_staff.name}</>}
                      {b.reference_photo_url && (
                        <>
                          {" "}
                          · <Camera size={11} style={{ display: "inline", verticalAlign: -1 }} />
                        </>
                      )}
                    </div>
                  </span>
                  <span className={`status-badge status-${b.status}`}>{b.status.replace("_", "-")}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dash-side-col">
          {/* ---------- booking page ---------- */}
          <div className="card">
            <div className="eyebrow">Your booking page</div>
            <p style={{ marginTop: 8, marginBottom: 10 }}>Your customers can book appointments through:</p>
            <code className="dash-link-code">{bookingLink}</code>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={handleCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy link"}
              </button>
              <a href={bookingLink} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ flex: 1, textAlign: "center" }}>
                <ExternalLink size={14} /> View page
              </a>
            </div>
            <div className="dash-live-indicator">
              <span className="dash-live-dot" /> Your page is live
            </div>
          </div>

          {/* ---------- profile completion ---------- */}
          {completion && completion.percent < 100 && (
            <div className="card">
              <div className="eyebrow">Complete your business profile</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: "var(--brass-bright)" }}>{completion.percent}%</span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>complete</span>
              </div>
              <div className="completion-track">
                <div className="completion-fill" style={{ width: `${completion.percent}%` }} />
              </div>
              <div className="completion-checklist">
                {completion.items.map((item) => (
                  <div key={item.key} className={`completion-item${item.done ? " done" : ""}`}>
                    {item.done ? <Check size={13} /> : <span className="completion-dot" />}
                    {item.label}
                  </div>
                ))}
              </div>
              {completion.firstIncomplete && (
                <Link to={completion.firstIncomplete.to} className="btn btn-primary" style={{ width: "100%", marginTop: 14 }}>
                  Complete profile
                </Link>
              )}
            </div>
          )}
          {completion && completion.percent === 100 && (
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="dash-live-dot" />
              <span style={{ fontSize: 14 }}>Your business profile is complete.</span>
            </div>
          )}

          {/* ---------- team preview (shop accounts only) ---------- */}
          {barber?.account_type === "shop" && (
            <div className="card">
              <div className="dash-panel-head">
                <div className="eyebrow">Your team</div>
                <Link to="/dashboard/staff" className="dash-panel-link">
                  Manage team →
                </Link>
              </div>
              {staff === null ? (
                <p style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)" }}>
                  <Loader2 className="spinner" size={16} /> Loading…
                </p>
              ) : staff.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="Add your team"
                  body="So customers can pick who they want to book with."
                  action={
                    <Link to="/dashboard/staff" className="btn btn-primary" style={{ marginTop: 6 }}>
                      Add staff
                    </Link>
                  }
                />
              ) : (
                <div className="team-preview-list">
                  {staff.slice(0, 5).map((s) => (
                    <div key={s.id} className="team-preview-row">
                      <span className="team-preview-avatar">
                        {s.photo_url ? <img src={s.photo_url} alt="" /> : <User size={15} />}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{s.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{s.active ? "Barber" : "Hidden"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---------- manage your business ---------- */}
      <div style={{ marginTop: 28 }}>
        <div className="eyebrow">Manage your business</div>
        <div className="mgmt-grid">
          <ManagementCard
            icon={User}
            title="Profile"
            description="Update your barber information, photo, bio and social links."
            to="/dashboard/profile"
            actionLabel="Edit profile"
          />
          <ManagementCard
            icon={Scissors}
            title="Services"
            description="Manage services, prices and durations."
            to="/dashboard/services"
            actionLabel="Manage services"
          />
          <ManagementCard
            icon={Images}
            title="Styles"
            description="Manage haircut styles and portfolio images."
            to="/dashboard/styles"
            actionLabel="Manage styles"
          />
          <ManagementCard
            icon={Clock}
            title="Hours"
            description="Set your weekly working schedule."
            to="/dashboard/hours"
            actionLabel="Manage hours"
          />
          <ManagementCard
            icon={SlidersHorizontal}
            title="Booking Rules"
            description="Configure booking preferences."
            to="/dashboard/booking-settings"
            actionLabel="Manage booking rules"
          />
          {barber?.account_type === "shop" && (
            <ManagementCard icon={Users} title="Team" description="Add or remove staff, and set each one's hours." to="/dashboard/staff" actionLabel="Manage team" />
          )}
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  );
}