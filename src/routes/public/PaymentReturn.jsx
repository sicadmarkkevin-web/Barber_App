import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Loader2, Check, X, Clock } from "lucide-react";
import { getBookingPaymentStatus } from "../../api/payments";
import { formatPHP } from "../../utils/currency";

/**
 * Where the customer lands after PayMongo's hosted checkout page. Never
 * trusts the URL alone (a customer returning is not proof of payment) —
 * always fetches the real, server-recorded status via
 * get_booking_payment_status, which only the webhook (Phase 3) can ever
 * move to "paid". Polls briefly since the webhook can arrive a few seconds
 * after the customer's browser redirect does.
 */
export default function PaymentReturn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const bookingId = searchParams.get("booking");
  const cancelledInCheckout = searchParams.get("cancelled") === "1";

  const [status, setStatus] = useState(null); // null = loading
  const [pollCount, setPollCount] = useState(0);
  const MAX_POLLS = 8; // ~24s at 3s intervals — after that, stop assuming the webhook is still coming

  useEffect(() => {
    if (!bookingId) return;
    let active = true;
    getBookingPaymentStatus(bookingId)
      .then((data) => active && setStatus(data))
      .catch(() => active && setStatus(null));
    return () => {
      active = false;
    };
  }, [bookingId, pollCount]);

  useEffect(() => {
    if (!bookingId || cancelledInCheckout) return;
    if (status?.payment_status && status.payment_status !== "pending") return; // resolved — stop polling
    if (pollCount >= MAX_POLLS) return;
    const t = setTimeout(() => setPollCount((c) => c + 1), 3000);
    return () => clearTimeout(t);
  }, [bookingId, cancelledInCheckout, status, pollCount]);

  if (!bookingId) {
    return (
      <div className="center-screen" style={{ flexDirection: "column", textAlign: "center", padding: 24 }}>
        <h1 style={{ fontSize: 22 }}>Payment status unavailable</h1>
        <p style={{ marginTop: 8, maxWidth: 340 }}>We couldn't find which booking this payment was for.</p>
        <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => navigate("/")}>
          Done
        </button>
      </div>
    );
  }

  if (cancelledInCheckout) {
    return (
      <div className="center-screen" style={{ flexDirection: "column", textAlign: "center", padding: 24 }}>
        <h1 style={{ fontSize: 22 }}>Payment cancelled</h1>
        <p style={{ marginTop: 8, maxWidth: 340 }}>
          No worries — your appointment is still booked. You can pay the deposit at your appointment instead.
        </p>
        <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => navigate("/")}>
          Done
        </button>
      </div>
    );
  }

  const paymentStatus = status?.payment_status;
  const stillWaiting = !paymentStatus || paymentStatus === "pending";
  const gaveUpWaiting = stillWaiting && pollCount >= MAX_POLLS;

  return (
    <div className="center-screen" style={{ flexDirection: "column", textAlign: "center", padding: 24 }}>
      {paymentStatus === "paid" && (
        <>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--sage)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Check size={28} color="#12261c" />
          </div>
          <h1 style={{ fontSize: 22, marginTop: 16 }}>Payment confirmed!</h1>
          <p style={{ marginTop: 8 }}>Your appointment is confirmed.</p>
          <div className="card" style={{ marginTop: 20, textAlign: "left", maxWidth: 320, width: "100%" }}>
            <div className="review-line">
              <span>Total</span>
              <span>{formatPHP(status.total_amount)}</span>
            </div>
            <div className="review-line">
              <span>Deposit paid</span>
              <span>{formatPHP(status.amount_paid)}</span>
            </div>
            <div className="review-line">
              <span>Remaining</span>
              <span>{formatPHP(status.remaining_balance)}</span>
            </div>
          </div>
        </>
      )}

      {paymentStatus === "failed" && (
        <>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--rust)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={28} color="#2a0f0d" />
          </div>
          <h1 style={{ fontSize: 22, marginTop: 16 }}>Payment was unsuccessful</h1>
          <p style={{ marginTop: 8, maxWidth: 340 }}>
            Please try again, or pay the deposit at your appointment instead. Your booking is still held.
          </p>
        </>
      )}

      {paymentStatus === "expired" && (
        <>
          <Clock size={40} color="var(--muted)" />
          <h1 style={{ fontSize: 22, marginTop: 16 }}>Payment session expired</h1>
          <p style={{ marginTop: 8, maxWidth: 340 }}>
            No worries — your appointment is still booked. You can pay the deposit at your appointment instead.
          </p>
        </>
      )}

      {stillWaiting && !gaveUpWaiting && (
        <>
          <Loader2 className="spinner" size={28} color="var(--brass)" />
          <h1 style={{ fontSize: 22, marginTop: 16 }}>Checking payment status…</h1>
          <p style={{ marginTop: 8, maxWidth: 340 }}>This usually only takes a few seconds.</p>
        </>
      )}

      {gaveUpWaiting && (
        <>
          <Clock size={40} color="var(--muted)" />
          <h1 style={{ fontSize: 22, marginTop: 16 }}>Payment is still being processed</h1>
          <p style={{ marginTop: 8, maxWidth: 340 }}>
            Your appointment is already booked either way — we'll keep checking, or you can refresh this page in a
            moment.
          </p>
        </>
      )}

      <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => navigate("/")}>
        Done
      </button>
    </div>
  );
}