import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Bell } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { updateMyBarberProfile } from "../../api/barbers";
import {
  withBookingSettingsDefaults,
  calculateDeposit,
  MIN_NOTICE_OPTIONS,
  MAX_ADVANCE_OPTIONS,
  BUFFER_OPTIONS,
} from "../../utils/bookingSettings";
import { formatPHP } from "../../utils/currency";
import { setPaymongoSecretKey, disconnectPaymongo } from "../../api/paymentProvider";
import {
  isPushSupported,
  getPushPermissionState,
  getCurrentDeviceSubscription,
  enablePushNotifications,
  disablePushNotifications,
} from "../../api/pushSubscriptions";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/shared/Toast";

export default function BookingSettingsManager() {
  const { barber, refreshBarber } = useAuth();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const [settings, setSettings] = useState(() => withBookingSettingsDefaults(barber?.booking_settings));
  const [saving, setSaving] = useState(false);
  const [secretKeyInput, setSecretKeyInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Per-device state — a barber may have push enabled on their phone but
  // not their laptop, so this reflects THIS browser only, not the barber
  // account as a whole (push_subscriptions can hold several rows per barber).
  const [pushSupported] = useState(isPushSupported());
  const [pushPermission, setPushPermission] = useState(getPushPermissionState());
  const [pushEnabledHere, setPushEnabledHere] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported) return;
    getCurrentDeviceSubscription().then((sub) => setPushEnabledHere(!!sub));
  }, [pushSupported]);

  async function handleEnablePush() {
    setPushBusy(true);
    try {
      await enablePushNotifications(barber.id);
      setPushEnabledHere(true);
      setPushPermission(getPushPermissionState());
      showToast("Booking notifications enabled on this device.");
    } catch (err) {
      showToast(err.message || "Couldn't enable notifications.", "err");
      setPushPermission(getPushPermissionState());
    } finally {
      setPushBusy(false);
    }
  }

  async function handleDisablePush() {
    setPushBusy(true);
    try {
      await disablePushNotifications();
      setPushEnabledHere(false);
      showToast("Booking notifications disabled on this device.");
    } catch (err) {
      showToast(err.message || "Couldn't disable notifications.", "err");
    } finally {
      setPushBusy(false);
    }
  }

  function update(patch) {
    setSettings((prev) => ({ ...prev, ...patch }));
  }

  function validateSettings() {
    if (settings.min_advance_minutes < 0 || settings.max_advance_days <= 0 || settings.buffer_minutes < 0) {
      showToast("Couldn't save your booking settings.", "err");
      return false;
    }
    if (settings.deposit_type === "percentage") {
      const pct = Number(settings.deposit_percent);
      if (!(pct > 0) || pct > 100) {
        showToast("Deposit percentage must be between 1 and 100.", "err");
        return false;
      }
    }
    if (settings.deposit_type === "fixed") {
      const amt = Number(settings.deposit_amount);
      if (!(amt >= 0)) {
        showToast("Fixed deposit amount can't be negative.", "err");
        return false;
      }
    }
    return true;
  }

  // Preserve existing keys this screen doesn't manage (slot_interval_minutes,
  // cancellation_notice_hours) by merging into the full stored object.
  async function persistSettings() {
    const nextSettings = { ...withBookingSettingsDefaults(barber.booking_settings), ...settings };
    await updateMyBarberProfile(barber.id, { booking_settings: nextSettings });
    await refreshBarber();
  }

  async function handleSave() {
    // Dropdowns already constrain values to valid options, but guard anyway
    // since this configuration is what the booking engine will trust.
    if (!validateSettings()) return;
    setSaving(true);
    try {
      await persistSettings();
      showToast("Booking settings saved.");
    } catch (err) {
      showToast(err.message || "Couldn't save your booking settings.", "err");
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    if (!secretKeyInput.trim()) {
      showToast("Enter your PayMongo secret key first.", "err");
      return;
    }
    // "Connect PayMongo" used to be a separate action from "Save booking
    // settings" — a barber could enable online payments + check GCash/Maya,
    // click Connect, and never realize those toggles were never actually
    // saved (only the secret key + connection status were). Connecting now
    // also persists the current settings, so there's one less step to miss.
    if (!validateSettings()) return;
    setConnecting(true);
    try {
      await persistSettings();
      await setPaymongoSecretKey(barber.id, secretKeyInput.trim());
      setSecretKeyInput("");
      await refreshBarber();
      showToast("PayMongo connected.");
    } catch (err) {
      showToast(err.message || "Couldn't connect PayMongo. Please try again.", "err");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectPaymongo(barber.id);
      await refreshBarber();
      showToast("PayMongo disconnected.");
    } catch (err) {
      showToast(err.message || "Couldn't disconnect PayMongo. Please try again.", "err");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="container" style={{ paddingTop: 28, paddingBottom: 48, maxWidth: 480 }}>
      <button
        className="btn btn-ghost"
        style={{ width: "auto", padding: "8px 12px", marginBottom: 18 }}
        onClick={() => navigate("/dashboard")}
      >
        <ArrowLeft size={15} /> Dashboard
      </button>

      <div className="eyebrow">For your booking page</div>
      <h1 style={{ fontSize: 24, marginTop: 6 }}>Booking settings</h1>
      <p style={{ marginTop: 8 }}>
        These preferences will control how online booking works once it's built — for now they're
        just saved for later.
      </p>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="field">
          <label htmlFor="min-notice">Minimum booking notice</label>
          <select
            id="min-notice"
            value={settings.min_advance_minutes}
            onChange={(e) => update({ min_advance_minutes: Number(e.target.value) })}
            disabled={saving}
          >
            {MIN_NOTICE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="max-advance">Maximum advance booking window</label>
          <select
            id="max-advance"
            value={settings.max_advance_days}
            onChange={(e) => update({ max_advance_days: Number(e.target.value) })}
            disabled={saving}
          >
            {MAX_ADVANCE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="buffer">Buffer time between appointments</label>
          <select
            id="buffer"
            value={settings.buffer_minutes}
            onChange={(e) => update({ buffer_minutes: Number(e.target.value) })}
            disabled={saving}
          >
            {BUFFER_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <div className="switch-row">
            <label style={{ marginBottom: 0 }} htmlFor="allow-styles">
              Allow customers to choose a haircut style
            </label>
            <span className="switch">
              <input
                id="allow-styles"
                type="checkbox"
                checked={settings.allow_style_selection}
                onChange={(e) => update({ allow_style_selection: e.target.checked })}
                disabled={saving}
              />
              <span className="switch-track" onClick={() => !saving && update({ allow_style_selection: !settings.allow_style_selection })} />
            </span>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 6 }}>
          <div className="switch-row">
            <label style={{ marginBottom: 0 }} htmlFor="manual-confirm">
              Require manual confirmation for bookings
            </label>
            <span className="switch">
              <input
                id="manual-confirm"
                type="checkbox"
                checked={settings.manual_confirmation}
                onChange={(e) => update({ manual_confirmation: e.target.checked })}
                disabled={saving}
              />
              <span className="switch-track" onClick={() => !saving && update({ manual_confirmation: !settings.manual_confirmation })} />
            </span>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 6 }}>
          <div className="switch-row">
            <label style={{ marginBottom: 0 }} htmlFor="home-service">
              Offer home service
            </label>
            <span className="switch">
              <input
                id="home-service"
                type="checkbox"
                checked={settings.home_service_enabled}
                onChange={(e) => update({ home_service_enabled: e.target.checked })}
                disabled={saving}
              />
              <span className="switch-track" onClick={() => !saving && update({ home_service_enabled: !settings.home_service_enabled })} />
            </span>
          </div>
          <p className="hint-text" style={{ marginTop: 6 }}>
            When on, customers can choose to have you come to their location instead of visiting your shop.
          </p>
        </div>
      </div>

      <div className="eyebrow" style={{ marginTop: 24, marginBottom: 14 }}>Payment settings</div>
      <p style={{ marginTop: -8, marginBottom: 14 }}>
        Configure deposits and connect your own PayMongo account so customers can pay online. Money goes straight to
        your PayMongo account — this app never holds or touches it.
      </p>

      <div className="card">
        <div className="field" style={{ marginBottom: 6 }}>
          <div className="switch-row">
            <label style={{ marginBottom: 0 }} htmlFor="online-payments">
              Online payments
            </label>
            <span className="switch">
              <input
                id="online-payments"
                type="checkbox"
                checked={settings.online_payments_enabled}
                onChange={(e) => update({ online_payments_enabled: e.target.checked })}
                disabled={saving}
              />
              <span
                className="switch-track"
                onClick={() => !saving && update({ online_payments_enabled: !settings.online_payments_enabled })}
              />
            </span>
          </div>
          <p className="hint-text" style={{ marginTop: 6 }}>
            Requires connecting your PayMongo account below, and at least one payment method checked. Connecting will
            also save these toggles.
          </p>
        </div>

        <div className="field">
          <label>Payment methods</label>
          <div style={{ display: "flex", gap: 18, marginTop: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.payment_methods.gcash}
                onChange={(e) => update({ payment_methods: { ...settings.payment_methods, gcash: e.target.checked } })}
                disabled={saving}
              />
              GCash
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.payment_methods.maya}
                onChange={(e) => update({ payment_methods: { ...settings.payment_methods, maya: e.target.checked } })}
                disabled={saving}
              />
              Maya
            </label>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 6 }}>
          <label>Deposit requirement</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {[
              ["none", "No deposit"],
              ["percentage", "Percentage of the service price"],
              ["fixed", "Fixed amount"],
            ].map(([value, label]) => (
              <label key={value} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="deposit_type"
                  checked={settings.deposit_type === value}
                  onChange={() => update({ deposit_type: value })}
                  disabled={saving}
                />
                {label}
              </label>
            ))}
          </div>

          {settings.deposit_type === "percentage" && (
            <div style={{ marginTop: 10, maxWidth: 140 }}>
              <label htmlFor="deposit-percent" style={{ fontSize: 12 }}>
                Deposit percentage
              </label>
              <input
                id="deposit-percent"
                type="number"
                min={1}
                max={100}
                value={settings.deposit_percent}
                onChange={(e) => update({ deposit_percent: Number(e.target.value) })}
                disabled={saving}
              />
            </div>
          )}

          {settings.deposit_type === "fixed" && (
            <div style={{ marginTop: 10, maxWidth: 140 }}>
              <label htmlFor="deposit-fixed" style={{ fontSize: 12 }}>
                Deposit amount (₱)
              </label>
              <input
                id="deposit-fixed"
                type="number"
                min={0}
                step="0.01"
                value={settings.deposit_amount}
                onChange={(e) => update({ deposit_amount: Number(e.target.value) })}
                disabled={saving}
              />
            </div>
          )}

          {settings.deposit_type !== "none" && (
            <p className="hint-text" style={{ marginTop: 10 }}>
              Example: a ₱1,500 service would need a {formatPHP(calculateDeposit(1500, settings))} deposit, leaving{" "}
              {formatPHP(1500 - calculateDeposit(1500, settings))} due at the appointment.
            </p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="field" style={{ marginBottom: barber.paymongo_connected ? 0 : 6 }}>
          <label>Your PayMongo account</label>
          {barber.paymongo_connected ? (
            <div>
              <p style={{ marginTop: 6, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--sage)", display: "inline-block" }} />
                Connected
              </p>
              <button className="btn btn-ghost" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? <Loader2 className="spinner" size={16} /> : null}
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          ) : (
            <>
              <p className="hint-text" style={{ marginTop: 4, marginBottom: 10 }}>
                Paste your PayMongo secret key (Dashboard → Developers → API Keys). Deposits are charged directly to
                your own PayMongo account — never stored anywhere you or this app can read it back.
              </p>
              <input
                type="password"
                placeholder="sk_test_… or sk_live_…"
                value={secretKeyInput}
                onChange={(e) => setSecretKeyInput(e.target.value)}
                disabled={connecting}
              />
              <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={handleConnect} disabled={connecting}>
                {connecting ? <Loader2 className="spinner" size={16} /> : null}
                {connecting ? "Connecting…" : "Connect PayMongo"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="eyebrow" style={{ marginTop: 24, marginBottom: 14 }}>Notifications</div>
      <div className="card">
        <div className="field" style={{ marginBottom: 0 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Bell size={16} /> Booking notifications
          </label>
          <p className="hint-text" style={{ marginTop: 4, marginBottom: 12 }}>
            Get notified on this device when a customer books an appointment — even when the dashboard isn't open.
          </p>

          {!pushSupported && (
            <p className="hint-text" style={{ margin: 0 }}>
              This browser doesn't support push notifications. You'll still see new bookings in the notification
              bell whenever the dashboard is open.
            </p>
          )}

          {pushSupported && pushPermission === "denied" && (
            <p className="hint-text" style={{ margin: 0 }}>
              Notifications are blocked for this site in your browser settings. Allow notifications for this site,
              then reload this page to enable them here.
            </p>
          )}

          {pushSupported && pushPermission !== "denied" && !pushEnabledHere && (
            <button className="btn btn-primary" onClick={handleEnablePush} disabled={pushBusy}>
              {pushBusy ? <Loader2 className="spinner" size={16} /> : <Bell size={15} />}
              {pushBusy ? "Enabling…" : "Enable notifications"}
            </button>
          )}

          {pushSupported && pushEnabledHere && (
            <>
              <p style={{ margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--sage)", display: "inline-block" }} />
                Booking notifications enabled on this device
              </p>
              <button className="btn btn-ghost" onClick={handleDisablePush} disabled={pushBusy}>
                {pushBusy ? <Loader2 className="spinner" size={16} /> : null}
                {pushBusy ? "Disabling…" : "Disable notifications"}
              </button>
            </>
          )}
        </div>
      </div>

      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="spinner" size={16} /> : null}
        {saving ? "Saving…" : "Save booking settings"}
      </button>

      <Toast toast={toast} />
    </div>
  );
}