import { Link } from "react-router-dom";

export default function StatCard({ label, value, hint, icon: Icon, accent, to }) {
  const content = (
    <>
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        {Icon && (
          <span className={`stat-card-icon${accent ? ` stat-card-icon-${accent}` : ""}`}>
            <Icon size={15} />
          </span>
        )}
      </div>
      <div className="stat-card-value">{value}</div>
      {hint && <div className="stat-card-hint">{hint}</div>}
    </>
  );

  if (to) {
    return (
      <Link to={to} className="stat-card stat-card-link">
        {content}
      </Link>
    );
  }

  return <div className="stat-card">{content}</div>;
}