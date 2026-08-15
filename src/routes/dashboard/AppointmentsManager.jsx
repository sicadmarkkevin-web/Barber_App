import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Camera } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { listBookingsForBarber, updateBookingStatus, getReferencePhotoUrl } from "../../api/appointments";
import { formatPHP } from "../../utils/currency";
import { formatTime12h, formatFriendlyDate } from "../../utils/time";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/shared/Toast";
import ConfirmDialog from "../../components/shared/ConfirmDialog";

function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_LABELS = {
  pending: "Pending",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

// Reuses the existing status-* badge CSS (no new classes needed) by mapping
// each payment_status onto the closest-toned existing status color: paid ~
// confirmed (green), pending/partially_paid ~ pending (amber), failed/expired
// ~ cancelled/no_show (red), unpaid/refunded ~ completed (neutral).
const PAYMENT_STATUS_DISPLAY = {
  unpaid: { label: "Unpaid", className: "status-completed" },
  pending: { label: "Pending", className: "status-pending" },
  paid: { label: "Paid", className: "status-confirmed" },
  failed: { label: "Failed", className: "status-cancelled" },
  expired: { label: "Expired", className: "status-no_show" },
  partially_paid: { label: "Partially paid", className: "status-pending" },
  refunded: { label: "Refunded", className: "status-completed" },
};

function PaymentStatusBadge({ status }) {
  const display = PAYMENT_STATUS_DISPLAY[status] || { label: status, className: "status-completed" };
  return <span className={`status-badge ${display.className}`}>{display.label}</span>;
}

function AppointmentDetail({ appt, onClose, onStatusChanged }) {
  const { toast, showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  async function handleSetStatus(status, successMessage) {
    setBusy(true);
    try {
      const updated = await updateBookingStatus(appt.id, status);
      onStatusChanged(updated);
      showToast(successMessage);
    } catch (err) {
      showToast(err.message || "Couldn't update this appointment.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    setBusy(true);
    try {
      const updated = await updateBookingStatus(appt.id, "cancelled");
      onStatusChanged(updated);
      showToast("Appointment cancelled.");
      setConfirmingCancel(false);
    } catch (err) {
      showToast(err.message || "Couldn't cancel this appointment.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function handleViewPhoto() {
    setPhotoLoading(true);
    try {
      const url = await getReferencePhotoUrl(appt.reference_photo_url);
      setPhotoUrl(url);
    } catch (err) {
      showToast("Couldn't load the reference photo.", "err");
    } finally {
      setPhotoLoading(false);
    }
  }

  return (
    <div className="appt-detail-overlay">
      <div className="container" style={{ paddingTop: 20, paddingBottom: 40, maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button className="btn btn-ghost" style={{ width: "auto", padding: "8px 12px" }} onClick={onClose} disabled={busy}>
            <ArrowLeft size={15} /> Back
          </button>
          <StatusBadge status={appt.status} />
        </div>

        <h1 style={{ fontSize: 22, marginTop: 18 }}>
          {formatFriendlyDate(appt.date)} · {formatTime12h(appt.start_time)}
        </h1>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="eyebrow">Customer</div>
          <div className="review-line">
            <span>{appt.customers?.name}</span>
            <span>{appt.customers?.phone}</span>
          </div>
          {appt.customers?.email && (
            <div className="review-line">
              <span>Email</span>
              <span>{appt.customers.email}</span>
            </div>
          )}
        </div>

        {appt.barber_staff?.name && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="eyebrow">Barber</div>
            <p style={{ margin: "8px 0 0" }}>{appt.barber_staff.name}</p>
          </div>
        )}

        <div className="card" style={{ marginTop: 14 }}>
          <div className="eyebrow">Appointment</div>
          <div className="review-line">
            <span>{appt.services?.name}</span>
            <span>{formatPHP(appt.services?.price)}</span>
          </div>
          <div className="review-line">
            <span>Duration</span>
            <span>{appt.duration_minutes} min</span>
          </div>
        </div>

        {Number(appt.deposit_amount) > 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="dash-panel-head">
              <div className="eyebrow">Payment</div>
              <PaymentStatusBadge status={appt.payment_status} />
            </div>
            <div className="review-line" style={{ marginTop: 4 }}>
              <span>Total</span>
              <span>{formatPHP(appt.total_amount)}</span>
            </div>
            <div className="review-line">
              <span>Deposit</span>
              <span>{formatPHP(appt.deposit_amount)}</span>
            </div>
            <div className="review-line">
              <span>Remaining</span>
              <span>{formatPHP(appt.remaining_balance)}</span>
            </div>
            {appt.payment_provider && (
              <p className="hint-text" style={{ marginTop: 8, marginBottom: 0 }}>
                Via {appt.payment_provider === "gcash" ? "GCash" : "Maya"}
              </p>
            )}
          </div>
        )}

        <div className="card" style={{ marginTop: 14 }}>
          <div className="eyebrow">Haircut preference</div>
          {appt.hair_styles?.name ? (
            <p style={{ margin: "8px 0 0" }}>{appt.hair_styles.name}</p>
          ) : appt.reference_photo_url ? (
            photoUrl ? (
              <div style={{ marginTop: 10 }}>
                <img src={photoUrl} alt="Customer reference" style={{ width: "100%", borderRadius: "var(--radius-md)", display: "block" }} />
              </div>
            ) : (
              <button
                className="btn btn-ghost"
                style={{ width: "auto", padding: "9px 14px", marginTop: 10 }}
                onClick={handleViewPhoto}
                disabled={photoLoading}
              >
                {photoLoading ? <Loader2 className="spinner" size={15} /> : <Camera size={15} />}
                {photoLoading ? "Loading photo…" : "View reference photo"}
              </button>
            )
          ) : (
            <p style={{ margin: "8px 0 0" }}>No preference</p>
          )}
        </div>

        {appt.status === "pending" && (
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={() => setConfirmingCancel(true)} disabled={busy}>
              Cancel appointment
            </button>
            <button className="btn btn-primary" onClick={() => handleSetStatus("confirmed", "Appointment confirmed.")} disabled={busy}>
              {busy ? <Loader2 className="spinner" size={16} /> : null}
              {busy ? "Confirming…" : "Confirm appointment"}
            </button>
          </div>
        )}

        {appt.status === "confirmed" && (
          <div style={{ marginTop: 20 }}>
            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={() => handleSetStatus("completed", "Marked as completed.")}
              disabled={busy}
            >
              {busy ? <Loader2 className="spinner" size={16} /> : null}
              {busy ? "Saving…" : "Mark as completed"}
            </button>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => handleSetStatus("no_show", "Marked as no-show.")}
                disabled={busy}
              >
                Customer didn't show
              </button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmingCancel(true)} disabled={busy}>
                Cancel appointment
              </button>
            </div>
          </div>
        )}

        <Toast toast={toast} />
      </div>

      {confirmingCancel && (
        <ConfirmDialog
          title="Cancel this appointment?"
          confirmLabel="Cancel appointment"
          busy={busy}
          onCancel={() => setConfirmingCancel(false)}
          onConfirm={handleCancel}
        />
      )}
    </div>
  );
}

function AppointmentCard({ appt, onOpen }) {
  return (
    <button type="button" className="appt-card" onClick={() => onOpen(appt)}>
      <span className="appt-time">{formatTime12h(appt.start_time)}</span>
      <span className="appt-body">
        <div className="appt-customer">{appt.customers?.name || "Customer"}</div>
        <div className="appt-meta">
          {appt.services?.name} · {formatPHP(appt.services?.price)}
          {appt.barber_staff?.name && <> · with {appt.barber_staff.name}</>}
          {appt.reference_photo_url && (
            <>
              {" "}
              · <Camera size={11} style={{ display: "inline", verticalAlign: -1 }} /> Reference photo
            </>
          )}
        </div>
      </span>
      <StatusBadge status={appt.status} />
    </button>
  );
}

export default function AppointmentsManager() {
  const { barber } = useAuth();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const [bookings, setBookings] = useState(null); // null = loading
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!barber) return;
    let active = true;
    listBookingsForBarber(barber.id)
      .then((data) => active && setBookings(data))
      .catch((err) => active && setLoadError(err.message || "Couldn't load appointments."));
    return () => {
      active = false;
    };
  }, [barber]);

  const { today, upcoming, past } = useMemo(() => {
    if (!bookings) return { today: [], upcoming: [], past: [] };
    const todayISO = todayLocalISO();
    const t = [];
    const u = [];
    const p = [];
    for (const b of bookings) {
      if (b.date === todayISO) t.push(b);
      else if (b.date > todayISO) u.push(b);
      else p.push(b);
    }
    p.reverse(); // most recent past appointment first
    return { today: t, upcoming: u, past: p };
  }, [bookings]);

  function handleStatusChanged(updated) {
    setBookings((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
    setSelected((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
  }

  return (
    <div className="container" style={{ paddingTop: 28, paddingBottom: 48, maxWidth: 480 }}>
      <button className="btn btn-ghost" style={{ width: "auto", padding: "8px 12px", marginBottom: 18 }} onClick={() => navigate("/dashboard")}>
        <ArrowLeft size={15} /> Dashboard
      </button>

      <div className="eyebrow">Your bookings</div>
      <h1 style={{ fontSize: 24, marginTop: 6 }}>Appointments</h1>

      {bookings === null && !loadError && (
        <p style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
          <Loader2 className="spinner" size={16} /> Loading appointments…
        </p>
      )}
      {loadError && <p className="error-text" style={{ marginTop: 18 }}>{loadError}</p>}

      {bookings && (
        <>
          <div className="appt-section-title">Today</div>
          {today.length === 0 ? <p className="hint-text">No appointments scheduled today.</p> : today.map((b) => <AppointmentCard key={b.id} appt={b} onOpen={setSelected} />)}

          <div className="appt-section-title">Upcoming</div>
          {upcoming.length === 0 ? <p className="hint-text">No upcoming appointments.</p> : upcoming.map((b) => <AppointmentCard key={b.id} appt={b} onOpen={setSelected} />)}

          <div className="appt-section-title">Past</div>
          {past.length === 0 ? <p className="hint-text">No past appointments.</p> : past.map((b) => <AppointmentCard key={b.id} appt={b} onOpen={setSelected} />)}
        </>
      )}

      {selected && <AppointmentDetail appt={selected} onClose={() => setSelected(null)} onStatusChanged={handleStatusChanged} />}

      <Toast toast={toast} />
    </div>
  );
}