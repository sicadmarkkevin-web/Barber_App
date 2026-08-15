import { Link } from "react-router-dom";

export default function ManagementCard({ icon: Icon, title, description, to, actionLabel }) {
  return (
    <Link to={to} className="mgmt-card">
      <span className="mgmt-card-icon">
        <Icon size={17} />
      </span>
      <span className="mgmt-card-title">{title}</span>
      <span className="mgmt-card-desc">{description}</span>
      <span className="mgmt-card-action">{actionLabel} →</span>
    </Link>
  );
}
