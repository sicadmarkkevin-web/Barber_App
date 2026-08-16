import { ChevronLeft, ChevronRight } from "lucide-react";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n) {
  return String(n).padStart(2, "0");
}
function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const firstWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * A separate component from booking/MonthCalendar.jsx on purpose — that one
 * is shared by the live customer booking flow (single-select, min/max/closed
 * days) and shouldn't be touched for an admin-only feature. This one shows a
 * per-day appointment count badge instead, and navigation is capped to a
 * fixed 3-month window rather than an open-ended min/max range.
 */
export default function AppointmentsCalendarMonth({ year, month, countsByDate, canGoPrev, canGoNext, onNavigate, onSelectDate }) {
  const today = startOfToday();
  const cells = buildMonthGrid(year, month);

  const goPrev = () => {
    if (canGoPrev) onNavigate("prev");
  };
  const goNext = () => {
    if (canGoNext) onNavigate("next");
  };

  return (
    <div>
      <div className="cal-nav">
        <button type="button" className="cal-nav-btn" onClick={goPrev} disabled={!canGoPrev}>
          <ChevronLeft size={16} />
        </button>
        <span className="cal-month-label">
          {MONTH_LABELS[month]} {year}
        </span>
        <button type="button" className="cal-nav-btn" onClick={goNext} disabled={!canGoNext}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="cal-weekdays">
        {DAY_LABELS.map((d) => (
          <span key={d}>{d[0]}</span>
        ))}
      </div>

      <div className="cal-grid">
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="cal-cell cal-cell-blank" />;
          const dstr = fmtDate(d);
          const count = countsByDate.get(dstr) || 0;
          const hasAppointments = count > 0;
          const isToday = dstr === fmtDate(today);
          return (
            <button
              key={i}
              type="button"
              className={`cal-cell ${hasAppointments ? "cal-cell-has-appts" : "cal-cell-empty"} ${isToday ? "cal-cell-today" : ""}`}
              onClick={() => hasAppointments && onSelectDate(dstr)}
              disabled={!hasAppointments}
            >
              <span className="cal-cell-daynum">{d.getDate()}</span>
              {hasAppointments && <span className="cal-cell-badge">{count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}