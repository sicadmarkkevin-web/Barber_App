import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Scissors, Loader2 } from "lucide-react";
import { signUpBarber } from "../api/auth";

export default function Signup() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const data = await signUpBarber({ email, password, fullName, phone });
      if (data.session) {
        // Email confirmation disabled — signed in immediately, head to onboarding.
        navigate("/onboarding", { replace: true });
      } else {
        // Email confirmation required by the Supabase project settings.
        navigate("/login", {
          replace: true,
          state: { message: "Check your email to confirm your account, then sign in." },
        });
      }
    } catch (err) {
      setError(err.message || "Couldn't create your account. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="container" style={{ maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <Scissors size={26} color="var(--brass)" />
          <h1 style={{ fontSize: 28, marginTop: 10 }}>Create your booking page</h1>
          <p style={{ marginTop: 6 }}>Takes about five minutes. No credit card needed.</p>
        </div>

        <form className="card" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="fullName">Your name</label>
            <input id="fullName" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
            />
            <p className="hint-text">At least 8 characters.</p>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spinner" size={16} /> : null}
            {busy ? "Creating account…" : "Continue"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 18, fontSize: 13.5 }}>
          Already have a page? <Link className="link" to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
