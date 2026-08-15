export default function StatCard({ label, value, hint, icon: Icon, accent }) {
  return (
    <div className="stat-card">
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
    </div>
  );
}
