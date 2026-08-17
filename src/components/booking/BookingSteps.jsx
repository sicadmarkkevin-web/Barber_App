import { useRef, useState } from "react";
import { Loader2, Check, Scissors, Camera, User, Copy, Share2 } from "lucide-react";
import { formatPHP } from "../../utils/currency";
import { withBookingSettingsDefaults, calculateDeposit } from "../../utils/bookingSettings";
import HairIcon from "../shared/HairIcon";
import MonthCalendar from "./MonthCalendar";

function formatFriendlyDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function StaffStep({ staff, selectedId, onSelect }) {
  if (staff === null) {
    return (
      <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 className="spinner" size={16} /> Loading barbers…
      </p>
    );
  }
  if (staff.length === 0) {
    return <p>No barbers are available for booking right now.</p>;
  }
  return (
    <div>
      {staff.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`select-row ${selectedId === s.id ? "selected" : ""}`}
          onClick={() => onSelect(s)}
        >
          <span className="select-row-radio" />
          <span
            className="select-row-thumb"
            style={{
              borderRadius: "50%",
              ...(s.photo_url ? { backgroundImage: `url(${s.photo_url})` } : {}),
            }}
          >
            {!s.photo_url && <User size={22} />}
          </span>
          <span className="select-row-body">
            <div className="select-row-title">{s.name}</div>
            {s.bio && <div className="select-row-meta">{s.bio}</div>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function ServiceStep({ services, selectedId, onSelect }) {
  if (services === null) {
    return (
      <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 className="spinner" size={16} /> Loading services…
      </p>
    );
  }
  if (services.length === 0) {
    return <p>This barber hasn't added any services yet.</p>;
  }
  return (
    <div>
      {services.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`select-row ${selectedId === s.id ? "selected" : ""}`}
          onClick={() => onSelect(s)}
        >
          <span className="select-row-radio" />
          <span className="select-row-body">
            <div className="select-row-title">{s.name}</div>
            <div className="select-row-meta">
              {formatPHP(s.price)} · {s.duration_minutes} min
            </div>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Replaces the old style-only step. `mode` ("choice" | "style-list" | "photo")
 * is controlled by the parent (BookingFlow) rather than local state, because
 * the sticky footer's Back/Continue behavior needs to know which sub-view is
 * showing.
 */
export function HaircutDescriptionStep({
  mode,
  styles,
  selectedStyleId,
  photoPreview,
  photoUploading,
  onChooseStyleMode,
  onChoosePhotoMode,
  onNoPreference,
  onSelectStyle,
  onPickPhotoFile,
  onRemovePhoto,
}) {
  const fileInputRef = useRef(null);

  if (mode === "choice") {
    return (
      <div>
        <p style={{ marginBottom: 16 }}>How would you like to describe your haircut?</p>
        <button type="button" className="choice-btn" onClick={onChooseStyleMode}>
          <Scissors size={18} /> Choose a Style
        </button>
        <button type="button" className="choice-btn" onClick={onChoosePhotoMode}>
          <Camera size={18} /> Upload Reference Photo
        </button>
        <button type="button" className="choice-btn" onClick={onNoPreference}>
          No Preference
        </button>
      </div>
    );
  }

  if (mode === "style-list") {
    if (styles === null) {
      return (
        <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 className="spinner" size={16} /> Loading styles…
        </p>
      );
    }
    if (styles.length === 0) {
      return <p>This barber hasn't added any styles yet — go back and try a reference photo or no preference instead.</p>;
    }
    return (
      <div>
        {styles.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`select-row ${selectedStyleId === s.id ? "selected" : ""}`}
            onClick={() => onSelectStyle(s)}
          >
            <span className="select-row-radio" />
            <span className="select-row-thumb" style={s.image_url ? { backgroundImage: `url(${s.image_url})` } : undefined}>
              {!s.image_url && <HairIcon type={s.icon || "fade"} size={26} />}
            </span>
            <span className="select-row-body">
              <div className="select-row-title">{s.name}</div>
            </span>
          </button>
        ))}
      </div>
    );
  }

  // mode === "photo"
  return (
    <div style={{ textAlign: "center" }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPickPhotoFile(f);
        }}
      />
      {photoPreview ? (
        <>
          <div className="ref-photo-preview" style={{ backgroundImage: `url(${photoPreview})` }} />
          {photoUploading && (
            <p style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10 }}>
              <Loader2 className="spinner" size={14} /> Uploading…
            </p>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "center" }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "auto", padding: "10px 16px" }}
              onClick={() => fileInputRef.current?.click()}
              disabled={photoUploading}
            >
              Replace photo
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "auto", padding: "10px 16px" }}
              onClick={onRemovePhoto}
              disabled={photoUploading}
            >
              Remove photo
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="choice-btn" onClick={() => fileInputRef.current?.click()}>
          <Camera size={18} /> Upload Reference Photo
        </button>
      )}
    </div>
  );
}

/** Ported MonthCalendar wrapper — selecting a valid day advances the flow immediately,
 * same single-tap pattern as the other quick-decision steps. */
export function DateStep({ year, month, value, minDate, maxDate, maxAdvanceDays, isDateDisabled, onNavigate, onSelect }) {
  return (
    <div>
      <MonthCalendar
        year={year}
        month={month}
        selected={value}
        minDate={minDate}
        maxDate={maxDate}
        isDateDisabled={isDateDisabled}
        onNavigate={onNavigate}
        onSelect={onSelect}
      />
      <p className="hint-text" style={{ marginTop: 12 }}>
        This barber accepts bookings up to {maxAdvanceDays} days in advance.
      </p>
    </div>
  );
}

export function TimeStep({ loading, slots, error, selectedStart, onSelect }) {
  if (loading) {
    return (
      <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 className="spinner" size={16} /> Checking availability…
      </p>
    );
  }
  if (error) {
    return <p className="error-text">Couldn't check availability for this date. Please try again.</p>;
  }
  if (slots && slots.length === 0) {
    return <p>No appointments available for this date. Please choose another date.</p>;
  }
  if (!slots) return null;
  return (
    <div className="time-slot-grid">
      {slots.map((slot) => (
        <button
          key={slot.start}
          type="button"
          className={`time-slot-btn ${selectedStart === slot.start ? "selected" : ""}`}
          onClick={() => onSelect(slot)}
        >
          {slot.label}
        </button>
      ))}
    </div>
  );
}

export function DetailsStep({ name, phone, email, notes, errors, onChange }) {
  return (
    <div>
      <div className="field">
        <label htmlFor="cust-name">Full name</label>
        <input id="cust-name" type="text" value={name} onChange={(e) => onChange({ name: e.target.value })} />
        {errors.name && <p className="error-text">{errors.name}</p>}
      </div>
      <div className="field">
        <label htmlFor="cust-phone">Phone number</label>
        <input
          id="cust-phone"
          type="tel"
          value={phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          placeholder="09XXXXXXXXX"
        />
        {errors.phone && <p className="error-text">{errors.phone}</p>}
      </div>
      <div className="field">
        <label htmlFor="cust-email">Email (optional)</label>
        <input id="cust-email" type="email" value={email} onChange={(e) => onChange({ email: e.target.value })} />
        {errors.email && <p className="error-text">{errors.email}</p>}
      </div>
      <div className="field">
        <label htmlFor="cust-notes">Notes / special requests (optional)</label>
        <textarea
          id="cust-notes"
          rows={3}
          value={notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Anything the barber should know before your appointment?"
        />
      </div>
    </div>
  );
}

export function PayDepositStep({ barber, service, depositAmount, paying, onPay, onSkip }) {
  const methods = withBookingSettingsDefaults(barber.booking_settings).payment_methods;
  const remaining = service.price - depositAmount;

  return (
    <div>
      <div className="card">
        <div className="eyebrow">Deposit required</div>
        <div className="review-line" style={{ marginTop: 8 }}>
          <span>Amount being charged now</span>
          <span style={{ fontWeight: 700, color: "var(--brass)" }}>{formatPHP(depositAmount)}</span>
        </div>
        <p className="hint-text" style={{ marginTop: 8 }}>
          {formatPHP(remaining)} remaining, payable at your appointment.
        </p>
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {methods.gcash && (
          <button className="btn btn-primary" onClick={() => onPay("gcash")} disabled={paying}>
            {paying ? <Loader2 className="spinner" size={16} /> : null}
            Pay with GCash
          </button>
        )}
        {methods.maya && (
          <button className="btn btn-primary" onClick={() => onPay("maya")} disabled={paying}>
            {paying ? <Loader2 className="spinner" size={16} /> : null}
            Pay with Maya
          </button>
        )}
      </div>

      <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onSkip} disabled={paying}>
        I'll pay the deposit at my appointment
      </button>
    </div>
  );
}

export function ReviewStep({ barber, staffMember, service, style, photoPreview, date, slot, name, phone, email, notes }) {
  const depositAmount = calculateDeposit(service.price, withBookingSettingsDefaults(barber.booking_settings));
  return (
    <div>
      <div className="card">
        <div className="eyebrow">{barber.shop_name}</div>
        {staffMember && (
          <div className="review-line">
            <span>Barber</span>
            <span>{staffMember.name}</span>
          </div>
        )}
        <div className="review-line">
          <span>{service.name}</span>
          <span>{formatPHP(service.price)}</span>
        </div>
        <div className="review-line">
          <span>Duration</span>
          <span>{service.duration_minutes} min</span>
        </div>
        {style ? (
          <div className="review-line">
            <span>Style</span>
            <span>{style.name}</span>
          </div>
        ) : photoPreview ? (
          <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Reference photo</div>
            <div className="ref-photo-preview" style={{ width: 84, height: 84, margin: 0, backgroundImage: `url(${photoPreview})` }} />
          </div>
        ) : (
          <div className="review-line">
            <span>Haircut</span>
            <span>No preference</span>
          </div>
        )}
        <div className="review-line">
          <span>Date</span>
          <span>{formatFriendlyDate(date)}</span>
        </div>
        <div className="review-line">
          <span>Time</span>
          <span>{slot.label}</span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="eyebrow">Customer</div>
        <div className="review-line">
          <span>{name}</span>
          <span>{phone}</span>
        </div>
        {email && (
          <div className="review-line">
            <span>Email</span>
            <span>{email}</span>
          </div>
        )}
      </div>

      {notes && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="eyebrow">Notes</div>
          <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{notes}</p>
        </div>
      )}

      {depositAmount > 0 ? (
        <>
          <div className="review-line" style={{ marginTop: 14 }}>
            <span>Total</span>
            <span>{formatPHP(service.price)}</span>
          </div>
          <div className="review-line" style={{ fontSize: 16, fontWeight: 700, border: "none" }}>
            <span>Deposit due now</span>
            <span style={{ color: "var(--brass)" }}>{formatPHP(depositAmount)}</span>
          </div>
          <p className="hint-text" style={{ marginTop: -2 }}>
            {formatPHP(service.price - depositAmount)} remaining, payable at your appointment.
          </p>
        </>
      ) : (
        <div className="review-line" style={{ marginTop: 14, fontSize: 16, fontWeight: 700, border: "none" }}>
          <span>Total</span>
          <span style={{ color: "var(--brass)" }}>{formatPHP(service.price)}</span>
        </div>
      )}
    </div>
  );
}

export function SuccessStep({ barber, staffMember, service, style, hasReferencePhoto, date, slot, name, phone, notes, bookingReference }) {
  const depositAmount = calculateDeposit(service.price, withBookingSettingsDefaults(barber.booking_settings));
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const shareText = `My appointment at ${barber.shop_name}\n\nReference: ${bookingReference}\nService: ${service.name}\n${date ? `Date: ${formatFriendlyDate(date)}\n` : ""}${slot ? `Time: ${slot.label}` : ""}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(bookingReference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (older browser, insecure context, or
      // permission denied) — graceful no-op rather than a broken button;
      // the reference is already shown as plain selectable text above.
    }
  }

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Appointment at ${barber.shop_name}`, text: shareText });
      } catch {
        // Share sheet dismissed/cancelled by the person — not an error.
      }
      return;
    }
    // No Web Share API support: fall back to copying the same summary text
    // instead of leaving the button non-functional.
    try {
      await navigator.clipboard.writeText(shareText);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // Nothing more we can do here — the reference itself is still visible
      // and copyable on its own.
    }
  }

  return (
    <div style={{ textAlign: "center", paddingTop: 30 }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "var(--sage)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto",
        }}
      >
        <Check size={30} color="#12261c" />
      </div>
      <h1 style={{ fontSize: 24, marginTop: 18 }}>Booking confirmed!</h1>
      <p style={{ marginTop: 6 }}>Your barber has received your appointment details.</p>

      {bookingReference && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="eyebrow">Appointment reference</div>
          <div className="booking-ref">{bookingReference}</div>
          <p className="hint-text" style={{ marginTop: 6 }}>
            Please save this reference. You may show it to the business when you arrive.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={handleCopy}>
              <Copy size={15} /> {copied ? "Copied!" : "Copy reference"}
            </button>
            <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={handleShare}>
              <Share2 size={15} /> {shared ? "Copied!" : "Share"}
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 20, textAlign: "left" }}>
        <div className="eyebrow">{barber.shop_name}</div>
        {staffMember && (
          <div className="review-line">
            <span>Barber</span>
            <span>{staffMember.name}</span>
          </div>
        )}
        <div className="review-line">
          <span>{service.name}</span>
          <span>{formatPHP(service.price)}</span>
        </div>
        {style && (
          <div className="review-line">
            <span>Style</span>
            <span>{style.name}</span>
          </div>
        )}
        {!style && hasReferencePhoto && (
          <div className="review-line">
            <span>Haircut</span>
            <span>Reference photo attached</span>
          </div>
        )}
        <div className="review-line">
          <span>{formatFriendlyDate(date)}</span>
          <span>{slot.label}</span>
        </div>
        <div className="review-line">
          <span>Duration</span>
          <span>{service.duration_minutes} min</span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14, textAlign: "left" }}>
        <div className="eyebrow">Customer</div>
        <div className="review-line">
          <span>{name}</span>
          <span>{phone}</span>
        </div>
      </div>

      {notes && (
        <div className="card" style={{ marginTop: 14, textAlign: "left" }}>
          <div className="eyebrow">Notes</div>
          <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{notes}</p>
        </div>
      )}

      {depositAmount > 0 && (
        <div className="card" style={{ marginTop: 14, textAlign: "left" }}>
          <div className="eyebrow">Payment</div>
          <div className="review-line">
            <span>Deposit due now</span>
            <span style={{ color: "var(--brass)" }}>{formatPHP(depositAmount)}</span>
          </div>
          <p className="hint-text" style={{ marginTop: 8, marginBottom: 0 }}>
            {formatPHP(service.price - depositAmount)} remaining, payable at your appointment.
          </p>
        </div>
      )}
    </div>
  );
}