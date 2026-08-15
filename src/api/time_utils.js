/** "09:00" or "09:00:00" -> "9:00 AM". Used for public-page and read-only display. */
export function formatTime12h(value) {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export const DAYS_MON_FIRST = [
  { day_of_week: 1, label: "Monday" },
  { day_of_week: 2, label: "Tuesday" },
  { day_of_week: 3, label: "Wednesday" },
  { day_of_week: 4, label: "Thursday" },
  { day_of_week: 5, label: "Friday" },
  { day_of_week: 6, label: "Saturday" },
  { day_of_week: 0, label: "Sunday" },
];

/** "2026-08-15" -> "Saturday, August 15, 2026". Shared by the booking flow and the dashboard. */
export function formatFriendlyDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Today's date as "YYYY-MM-DD" in the visitor's local time zone. */
export function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday-Sunday range (inclusive, "YYYY-MM-DD") containing today — used for "this week" dashboard stats. */
export function currentWeekRangeISO() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: toISO(monday), end: toISO(sunday) };
}

/** 1st-to-last-day range (inclusive, "YYYY-MM-DD") of the current calendar month — used for the income filter. */
export function currentMonthRangeISO() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: toISO(start), end: toISO(end) };
}

/** Jan 1-to-Dec 31 range (inclusive, "YYYY-MM-DD") of the current calendar year — used for the income filter. */
export function currentYearRangeISO() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear(), 11, 31);
  return { start: toISO(start), end: toISO(end) };
}