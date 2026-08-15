import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { createBarberProfile, checkUsernameAvailable } from "../../api/barbers";

/**
 * Phase 1 stub: a single-step "claim your username" form so the auth + database
 * foundation is testable end-to-end (signup → this → dashboard). The full 7-step
 * wizard (profile, services, styles, schedule, booking rules) from the brief
 * lands in Phase 2 as its own set of step components under ./steps/.
 */
export default function OnboardingWizard() {
  const { user, refreshBarber } = useAuth();
  const [accountType, setAccountType] = useState("solo");
  const [shopName, setShopName] = useState("");
  const [username, setUsername] = useState("");
  const [checking, setChecking] = useState(false);
  // usernameCheck.state is one of: "available" | "taken" | "error" (absent while untouched/checking)
  const [usernameCheck, setUsernameCheck] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  // Shared by the blur handler and the submit handler so "check on blur" and
  // "check again on submit" can't drift apart into two implementations.
  async function runUsernameCheck(value) {
    try {
      const result = await checkUsernameAvailable(value);
      setUsernameCheck(
        result.available
          ? { state: "available", username: result.username }
          : { state: "taken", reason: result.reason }
      );
      return result;
    } catch (err) {
      // A real Supabase/network failure — NOT a "username taken" result.
      // Surface it plainly instead of letting the caller treat it as "not available".
      console.error("Username availability check failed:", err);
      setUsernameCheck({
        state: "error",
        message: err.message || "Couldn't check that username. Try again.",
      });
      throw err;
    }
  }

  async function handleUsernameBlur() {
    if (!username) return;
    setChecking(true);
    try {
      await runUsernameCheck(username);
    } catch {
      // already recorded in usernameCheck by runUsernameCheck; nothing more to do here
    } finally {
      setChecking(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    // Always re-check right before creating the page — usernameCheck from the blur
    // event can be stale (typed further, someone else just took it, a prior check
    // errored out, etc.), so submit never relies on it alone.
    setChecking(true);
    let fresh;
    try {
      fresh = await runUsernameCheck(username);
    } catch (err) {
      setChecking(false);
      setError(`Couldn't verify that username: ${err.message || "unknown error"}. See console for details.`);
      return;
    }
    setChecking(false);

    if (!fresh.available) {
      setError(fresh.reason || "That username isn't available.");
      return;
    }

    setSubmitting(true);
    try {
      await createBarberProfile({
        shop_name: shopName,
        username: fresh.username,
        phone: user?.user_metadata?.phone || "",
        account_type: accountType,
      });
      await refreshBarber();
      // Shop accounts go straight on to add their staff before hitting the
      // dashboard, since a shop page with no staff has nobody to book with.
      navigate(accountType === "shop" ? "/dashboard/staff" : "/dashboard", { replace: true });
    } catch (err) {
      console.error("createBarberProfile failed:", err);
      setError(err.message || "Couldn't create your page. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="container" style={{ maxWidth: 420 }}>
        <div className="eyebrow">Step 1 of 1 — more steps coming in Phase 2</div>
        <h1 style={{ fontSize: 26, marginTop: 10 }}>Claim your page</h1>
        <p style={{ marginTop: 6 }}>You can add services, styles, and hours once your page exists.</p>

        <form className="card" style={{ marginTop: 20 }} onSubmit={handleSubmit}>
          <div className="field">
            <label>Are you a solo barber, or a shop with a team?</label>
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                className={`select-row ${accountType === "solo" ? "selected" : ""}`}
                onClick={() => setAccountType("solo")}
              >
                <span className="select-row-radio" />
                <span className="select-row-body">
                  <div className="select-row-title">Just me</div>
                  <div className="select-row-meta">One page, one calendar — for a solo barber.</div>
                </span>
              </button>
              <button
                type="button"
                className={`select-row ${accountType === "shop" ? "selected" : ""}`}
                onClick={() => setAccountType("shop")}
              >
                <span className="select-row-radio" />
                <span className="select-row-body">
                  <div className="select-row-title">A shop with a team</div>
                  <div className="select-row-meta">Add multiple barbers customers can choose from.</div>
                </span>
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="shopName">Shop or barber name</label>
            <input id="shopName" type="text" value={shopName} onChange={(e) => setShopName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="username">Your link</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--muted)", fontSize: 14 }}>yourapp.com/</span>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setUsernameCheck(null);
                }}
                onBlur={handleUsernameBlur}
                required
              />
            </div>
            {checking && <p className="hint-text">Checking availability…</p>}
            {!checking && usernameCheck?.state === "available" && (
              <p className="success-text">yourapp.com/{usernameCheck.username} is available.</p>
            )}
            {!checking && usernameCheck?.state === "taken" && (
              <p className="error-text">{usernameCheck.reason}</p>
            )}
            {!checking && usernameCheck?.state === "error" && (
              <p className="error-text">Error checking username: {usernameCheck.message}</p>
            )}
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="spinner" size={16} /> : null}
            {submitting ? "Creating your page…" : "Create my page"}
          </button>
        </form>
      </div>
    </div>
  );
}