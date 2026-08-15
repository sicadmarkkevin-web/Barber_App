import { Link } from "react-router-dom";
import { Scissors, ArrowRight } from "lucide-react";

export default function Landing() {
  return (
    <div className="app-shell">
      <div className="container-wide" style={{ paddingTop: 28, paddingBottom: 28 }}>
        <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Scissors size={20} color="var(--brass)" />
            <span style={{ fontFamily: "var(--font-display)", fontSize: 19 }}>Alora</span>
          </div>
          <div style={{ display: "flex", gap: 18, alignItems: "center", fontSize: 14 }}>
            <Link className="link" to="/login">Sign in</Link>
            <Link
              to="/signup"
              className="btn btn-primary"
              style={{ width: "auto", padding: "9px 16px" }}
            >
              Get your page
            </Link>
          </div>
        </nav>
      </div>

      <main style={{ flex: 1, display: "flex", alignItems: "center" }}>
        <div className="container-wide" style={{ paddingTop: 40, paddingBottom: 60 }}>
          <div className="eyebrow">One link. One barber. Every booking.</div>
          <h1 style={{ fontSize: "clamp(34px, 6vw, 58px)", maxWidth: 680, marginTop: 14 }}>
            Every barber gets their own booking page.
          </h1>
          <p style={{ maxWidth: 520, fontSize: 16.5, marginTop: 16 }}>
            Set your services, your prices, your hours, your styles. Get a link you can drop
            in a comment, a story, or a Messenger reply — customers land straight on your page
            and book, no app download, no back-and-forth.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
            <Link to="/signup" className="btn btn-primary" style={{ width: "auto", padding: "13px 22px" }}>
              Create your page <ArrowRight size={16} />
            </Link>
          </div>

          <div
            style={{
              marginTop: 64,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              maxWidth: 860,
            }}
          >
            {[
              ["01", "Set up your page", "Services, prices, hours, and haircut styles — five minutes, no code."],
              ["02", "Share your link", "yourapp.com/yourname — drop it anywhere you already post."],
              ["03", "Take bookings", "Customers pick a service and time, you get notified. That's it."],
            ].map(([n, title, body]) => (
              <div className="card" key={n}>
                <div className="eyebrow">{n}</div>
                <h3 style={{ fontSize: 18, marginTop: 10 }}>{title}</h3>
                <p style={{ fontSize: 14, marginTop: 8 }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
