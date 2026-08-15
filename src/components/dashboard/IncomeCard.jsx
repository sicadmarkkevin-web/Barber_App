import { formatPHP } from "../../utils/currency";

const PERIODS = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
];

export default function IncomeCard({ period, onPeriodChange, total, count }) {
  return (
    <div className="card income-card">
      <div className="dash-panel-head">
        <div className="eyebrow">Income</div>
        <div className="income-period-toggle">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`income-period-btn${period === p.key ? " active" : ""}`}
              onClick={() => onPeriodChange(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="income-amount">{formatPHP(total)}</div>
      <div className="income-meta">
        From {count} completed appointment{count === 1 ? "" : "s"}
      </div>
    </div>
  );
}