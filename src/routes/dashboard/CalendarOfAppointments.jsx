import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { listBookingsForBarber } from "../../api/appointments";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/shared/Toast";
import AppointmentsCalendarMonth from "../../components/dashboard/AppointmentsCalendarMonth";

function addMonths(year, month, delta) {
  const total = month + delta;
  return { year: year + Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export default function CalendarOfAppointments() {
  const { barber } = useAuth();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const [bookings, setBookings] = useState(null); // null = loading
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!barber) return;
    let active = true;
    listBookingsForBarber(barber.id)
      .then((data) => active && setBookings(data))
      .catch((err) => active && setLoadError(err.message || "Couldn't load your calendar."));
    return () => {
      active = false;
    };
  }, [barber]);

  // Fixed 3-month window starting at the current calendar month — matches
  // exactly what was asked for, not an open-ended browsable calendar.
  const now = new Date();
  const baseYear = now.getFullYear();
  const baseMonth = now.getMonth();
  const [monthIndex, setMonthIndex] = useState(0); // 0, 1, or 2
  const { year, month } = addMonths(baseYear, baseMonth, monthIndex);

  // Only confirmed bookings — explicitly excludes 'completed' (and every
  // other status), so marking a booking completed elsewhere in the app
  // removes it from here automatically, with no extra logic needed.
  const countsByDate = useMemo(() => {
    const map = new Map();
    if (!bookings) return map;
    for (const b of bookings) {
      if (b.status !== "confirmed") continue;
      map.set(b.date, (map.get(b.date) || 0) + 1);
    }
    return map;
  }, [bookings]);

  function handleNavigate(direction) {
    setMonthIndex((i) => (direction === "prev" ? Math.max(0, i - 1) : Math.min(2, i + 1)));
  }

  function handleSelectDate(dateStr) {
    navigate(`/dashboard/appointments?filter=day&date=${dateStr}`);
  }

  return (
    <div className="container" style={{ paddingTop: 28, paddingBottom: 48, maxWidth: 480 }}>
      <button className="btn btn-ghost" style={{ width: "auto", padding: "8px 12px", marginBottom: 18 }} onClick={() => navigate("/dashboard")}>
        <ArrowLeft size={15} /> Dashboard
      </button>

      <div className="eyebrow">Your schedule</div>
      <h1 style={{ fontSize: 24, marginTop: 6 }}>Calendar of Appointments</h1>
      <p style={{ marginTop: 6 }}>Confirmed appointments, by day. Tap a highlighted day to see them.</p>

      {bookings === null && !loadError && (
        <p style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
          <Loader2 className="spinner" size={16} /> Loading your calendar…
        </p>
      )}
      {loadError && <p className="error-text" style={{ marginTop: 18 }}>{loadError}</p>}

      {bookings && (
        <div className="card" style={{ marginTop: 18 }}>
          <AppointmentsCalendarMonth
            year={year}
            month={month}
            countsByDate={countsByDate}
            canGoPrev={monthIndex > 0}
            canGoNext={monthIndex < 2}
            onNavigate={handleNavigate}
            onSelectDate={handleSelectDate}
          />
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}