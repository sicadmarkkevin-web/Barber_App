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
// Builds a 7-wide grid (with leading/trailing blanks as null) for the given month.
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
 * Ported from the original single-file Alora app's MonthCalendar. Data source
 * changed: min/max range disabling still comes straight from minDate/maxDate,
 * but recurring days off and one-off blocked dates are now factored in too
 * via the optional `isDateDisabled(dateStr)` predicate — computed by the
 * caller from business_hours/staff_business_hours + blocked_dates, so this
 * component still doesn't know anything about those tables itself. It does
 * NOT know about existing bookings — that's still entirely
 * get_available_slots()'s job, called only after a date is picked here.
 */
export default function MonthCalendar({ year, month, selected, minDate, maxDate, isDateDisabled, onNavigate, onSelect }) {
  const today = startOfToday();
  const cells = buildMonthGrid(year, month);
  const isPastMonth = year < today.getFullYear() || (year === today.getFullYear() && month <= today.getMonth());

  const maxDateObj = maxDate ? new Date(`${maxDate}T00:00:00`) : null;
  const isFutureBeyondMax = !!maxDateObj && new Date(year, month, 1) > new Date(maxDateObj.getFullYear(), maxDateObj.getMonth(), 1);

  const goPrev = () => {
    if (isPastMonth) return;
    const m = month === 0 ? 11 : month - 1;
    const y = month === 0 ? year - 1 : year;
    onNavigate(y, m);
  };
  const goNext = () => {
    const m = month === 11 ? 0 : month + 1;
    const y = month === 11 ? year + 1 : year;
    onNavigate(y, m);
  };

  return (
    <div>
      <div className="cal-nav">
        <button type="button" className="cal-nav-btn" onClick={goPrev} disabled={isPastMonth}>
          <ChevronLeft size={16} />
        </button>
        <span className="cal-month-label">
          {MONTH_LABELS[month]} {year}
        </span>
        <button type="button" className="cal-nav-btn" onClick={goNext} disabled={isFutureBeyondMax}>
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
          const isPast = d < today;
          const beyondMax = maxDate ? dstr > maxDate : false;
          const beforeMin = minDate ? dstr < minDate : false;
          const closed = isDateDisabled ? isDateDisabled(dstr) : false;
          const disabled = isPast || beyondMax || beforeMin || closed;
          const isToday = dstr === fmtDate(today);
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              className={`cal-cell ${selected === dstr ? "cal-cell-active" : ""} ${disabled ? "cal-cell-disabled" : ""} ${isToday ? "cal-cell-today" : ""}`}
              onClick={() => onSelect(dstr)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}