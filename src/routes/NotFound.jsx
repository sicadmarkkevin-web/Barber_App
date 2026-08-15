import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="center-screen">
      <div style={{ textAlign: "center" }}>
        <div className="eyebrow">404</div>
        <h1 style={{ fontSize: 24, marginTop: 10 }}>Nothing here.</h1>
        <p style={{ marginTop: 8 }}>That page or booking link doesn't exist.</p>
        <Link className="link" to="/" style={{ display: "inline-block", marginTop: 14 }}>
          Go home
        </Link>
      </div>
    </div>
  );
}
