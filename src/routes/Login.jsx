import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Scissors, Loader2 } from "lucide-react";
import { signIn } from "../api/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn({ email, password });
      const dest = location.state?.from?.pathname || "/dashboard";
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message || "Couldn't sign you in. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="container" style={{ maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <Scissors size={26} color="var(--brass)" />
          <h1 style={{ fontSize: 28, marginTop: 10 }}>Welcome back</h1>
          <p style={{ marginTop: 6 }}>Sign in to manage your booking page.</p>
        </div>

        <form className="card" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spinner" size={16} /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 18, fontSize: 13.5 }}>
          New here? <Link className="link" to="/signup">Create your booking page</Link>
        </p>
      </div>
    </div>
  );
}
