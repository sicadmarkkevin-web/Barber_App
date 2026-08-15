export const BOOKING_SETTINGS_DEFAULTS = {
  min_advance_minutes: 60,
  max_advance_days: 30,
  buffer_minutes: 0,
  allow_style_selection: true,
  manual_confirmation: false,
  home_service_enabled: false,
  // Phase 1 payments (settings/calculation only — see chat, no live gateway
  // yet). deposit_type superseded the old boolean deposit_required + fixed-
  // only deposit_type from 0001, which was never actually exposed in this
  // settings screen; 'none' is now a real, explicit state instead.
  online_payments_enabled: false,
  payment_methods: { gcash: false, maya: false },
  deposit_type: "none", // "none" | "percentage" | "fixed"
  deposit_percent: 30,
  deposit_amount: 0, // pesos, only used when deposit_type === "fixed"
};

/** Merges the barber's stored booking_settings with defaults for any key that
 * predates this phase (or, for a brand-new barber, is entirely missing). */
export function withBookingSettingsDefaults(booking_settings) {
  const stored = booking_settings || {};
  // Every barber's stored settings already has SOME jsonb value (the column
  // itself is not-null with a default) — for barbers who onboarded before
  // Phase 1 payments existed, that default was deposit_type "fixed" +
  // deposit_amount 0 (from 0001, never actually exposed in this settings
  // screen), not a deliberate choice. `online_payments_enabled` only exists
  // on barbers who've saved settings since this phase shipped, so its
  // absence reliably signals "predates this phase" — normalize their
  // deposit_type to the new explicit "none" state instead of showing
  // "Fixed ₱0" as if someone had actually chosen that.
  const legacyOverrides = stored.online_payments_enabled === undefined ? { deposit_type: "none" } : {};
  return { ...BOOKING_SETTINGS_DEFAULTS, ...stored, ...legacyOverrides };
}

export const MIN_NOTICE_OPTIONS = [
  [0, "No minimum"],
  [30, "30 minutes"],
  [60, "1 hour"],
  [120, "2 hours"],
  [240, "4 hours"],
  [720, "12 hours"],
  [1440, "24 hours"],
  [2880, "48 hours"],
];

export const MAX_ADVANCE_OPTIONS = [
  [7, "7 days"],
  [14, "14 days"],
  [30, "30 days"],
  [60, "60 days"],
  [90, "90 days"],
];

export const BUFFER_OPTIONS = [
  [0, "0 minutes"],
  [5, "5 minutes"],
  [10, "10 minutes"],
  [15, "15 minutes"],
  [20, "20 minutes"],
  [30, "30 minutes"],
];

/**
 * Preview only, for the settings screen and the booking review step — the
 * actual amount charged is always recalculated server-side by the
 * `compute_deposit` SQL function inside create_booking, which this
 * intentionally mirrors (same rounding, same 0-100% clamp, same "can't
 * exceed the total" clamp) so the preview never disagrees with reality.
 */
export function calculateDeposit(total, settings) {
  const t = Number(total) || 0;
  if (t <= 0) return 0;

  let deposit = 0;
  if (settings.deposit_type === "percentage") {
    const pct = Number(settings.deposit_percent);
    if (pct > 0 && pct <= 100) {
      deposit = Math.round(((t * pct) / 100) * 100) / 100;
    }
  } else if (settings.deposit_type === "fixed") {
    const amt = Number(settings.deposit_amount);
    if (amt >= 0) deposit = amt;
  }
  return Math.min(deposit, t);
}