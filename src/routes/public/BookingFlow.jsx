import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, X, Loader2 } from "lucide-react";
import { getBarberByUsername } from "../../api/barbers";
import { listActiveServicesForBarber } from "../../api/services";
import { listStylesForBarber } from "../../api/styles";
import { listActiveStaffForBarber, getStaffClosedWeekdays } from "../../api/staff";
import { getClosedWeekdays } from "../../api/hours";
import { getBlockedDates } from "../../api/blockedDates";
import { getAvailableSlots } from "../../api/availability";
import { createBooking, friendlyBookingError, uploadReferencePhoto, removeReferencePhoto } from "../../api/bookings";
import { createCheckoutSession } from "../../api/payments";
import { withBookingSettingsDefaults } from "../../utils/bookingSettings";
import NotFound from "../NotFound";
import StepProgress from "../../components/booking/StepProgress";
import {
  StaffStep,
  ServiceStep,
  HaircutDescriptionStep,
  DateStep,
  TimeStep,
  DetailsStep,
  PayDepositStep,
  ReviewStep,
  SuccessStep,
} from "../../components/booking/BookingSteps";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/shared/Toast";

function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function isValidPhone(v) {
  return (v.match(/\d/g) || []).length >= 7;
}

export default function BookingFlow() {
  const { username } = useParams();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const [barber, setBarber] = useState(undefined); // undefined = loading, null = not found
  const [services, setServices] = useState(null);
  const [styles, setStyles] = useState(null);
  const [staff, setStaff] = useState(null); // null = loading/not fetched, [] = solo or no staff
  const [dateAvailability, setDateAvailability] = useState(null); // null = loading; else { closedWeekdays: Set<int>, blockedDates: Set<string> }

  // null until the initial step is decided (depends on whether a staff-picker
  // step is needed, which depends on `staff` finishing its fetch) — see the
  // "decide the starting step" effect below. Every other step transition sets
  // this directly, same as before.
  const [stepKey, setStepKey] = useState(null);
  const [styleMode, setStyleMode] = useState("choice"); // "choice" | "style-list" | "photo" — sub-view within the "style" step
  const [draft, setDraft] = useState({
    staffMember: null,
    service: null,
    style: null,
    referencePhotoPath: null, // storage path, set once upload finishes
    date: "",
    slot: null,
    name: "",
    phone: "",
    email: "",
  });
  const [detailErrors, setDetailErrors] = useState({});

  const [photoPreview, setPhotoPreview] = useState(null); // local blob URL, shown immediately on pick
  const [photoUploading, setPhotoUploading] = useState(false);

  const now = new Date();
  const [calendarYear, setCalendarYear] = useState(now.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(now.getMonth());

  const [slots, setSlots] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [createdBooking, setCreatedBooking] = useState(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let active = true;
    getBarberByUsername(username)
      .then((data) => active && setBarber(data))
      .catch(() => active && setBarber(null));
    return () => {
      active = false;
    };
  }, [username]);

  useEffect(() => {
    if (!barber) return;
    let active = true;
    listActiveServicesForBarber(barber.id)
      .then((data) => active && setServices(data))
      .catch(() => active && setServices([]));
    return () => {
      active = false;
    };
  }, [barber]);

  useEffect(() => {
    if (!barber) return;
    if (barber.account_type !== "shop") {
      // Solo accounts never had, and never need, a staff picker.
      setStaff([]);
      return;
    }
    let active = true;
    listActiveStaffForBarber(barber.id)
      .then((data) => active && setStaff(data))
      .catch(() => active && setStaff([]));
    return () => {
      active = false;
    };
  }, [barber]);

  // Styles are only ever needed once a has_styles service is picked, but
  // loading them lazily here (once, on first need) keeps the step components
  // simple — they just render whatever's in `styles`.
  useEffect(() => {
    if (!barber || !draft.service?.has_styles || styles !== null) return;
    let active = true;
    listStylesForBarber(barber.id)
      .then((data) => active && setStyles(data))
      .catch(() => active && setStyles([]));
    return () => {
      active = false;
    };
  }, [barber, draft.service, styles]);

  useEffect(() => {
    if (stepKey !== "time" || !barber || !draft.service || !draft.date) return;
    let active = true;
    setSlotsLoading(true);
    setSlots(null);
    setSlotsError(false);
    getAvailableSlots(barber.id, draft.service.id, draft.date, draft.staffMember?.id)
      .then((data) => active && setSlots(data))
      .catch((err) => {
        if (!active) return;
        console.error("getAvailableSlots failed on the Time step:", err);
        setSlots([]);
        setSlotsError(true);
      })
      .finally(() => active && setSlotsLoading(false));
    return () => {
      active = false;
    };
  }, [stepKey, barber, draft.service, draft.date, draft.staffMember]);

  // Recurring days off + one-off blocked dates, so the calendar can gray out
  // days the customer can't actually book instead of only discovering that
  // after picking one and seeing "no appointments available" in the time step.
  useEffect(() => {
    if (!barber) return;
    let active = true;
    const staffId = draft.staffMember?.id || null;
    const today = todayLocalISO();
    const maxAdvanceDays = barber.booking_settings?.max_advance_days ?? 30;

    setDateAvailability(null); // reset while (re)loading — e.g. switching staff members
    Promise.all([
      staffId ? getStaffClosedWeekdays(staffId) : getClosedWeekdays(barber.id),
      getBlockedDates(barber.id, today, addDaysISO(today, maxAdvanceDays)),
    ])
      .then(([closedWeekdays, blockedDates]) => {
        if (!active) return;
        setDateAvailability({ closedWeekdays: new Set(closedWeekdays), blockedDates: new Set(blockedDates) });
      })
      .catch((err) => {
        console.error("Failed to load closed days:", err);
        // Fail open — get_available_slots is still the real authority, this
        // is only a head start on graying out obviously-closed days.
        if (active) setDateAvailability({ closedWeekdays: new Set(), blockedDates: new Set() });
      });
    return () => {
      active = false;
    };
  }, [barber, draft.staffMember]);

  const steps = useMemo(() => {
    const base = draft.service?.has_styles
      ? ["service", "style", "date", "time", "details", "review"]
      : ["service", "date", "time", "details", "review"];
    const needsStaffStep = barber?.account_type === "shop" && staff && staff.length > 0;
    return needsStaffStep ? ["staff", ...base] : base;
  }, [draft.service, barber, staff]);
  const stepLabels = { staff: "Barber", service: "Service", style: "Style", date: "Date", time: "Time", details: "Details", review: "Review" };
  const stepIndex = Math.max(steps.indexOf(stepKey), 0);

  // Decide the starting step once we know whether a staff picker is needed —
  // runs once (guarded by `stepKey === null`), the same moment `steps[0]`
  // becomes meaningful for the first time.
  useEffect(() => {
    if (stepKey !== null || !barber || staff === null) return;
    setStepKey(steps[0]);
  }, [stepKey, barber, staff, steps]);

  function isDateDisabled(dateStr) {
    if (!dateAvailability) return false; // still loading — never over-block; get_available_slots is the real gate
    const weekday = new Date(`${dateStr}T00:00:00`).getDay();
    return dateAvailability.closedWeekdays.has(weekday) || dateAvailability.blockedDates.has(dateStr);
  }

  function clearPhoto() {
    if (draft.referencePhotoPath) removeReferencePhoto(draft.referencePhotoPath);
    setPhotoPreview(null);
    setDraft((d) => ({ ...d, referencePhotoPath: null }));
  }

  function goBack() {
    // Inside the style step's sub-views, Back returns to the choice screen
    // rather than leaving the step entirely.
    if (stepKey === "style" && styleMode !== "choice") {
      setStyleMode("choice");
      return;
    }
    const i = steps.indexOf(stepKey);
    if (i > 0) setStepKey(steps[i - 1]);
  }

  function selectStaff(staffMember) {
    setDraft((d) => ({ ...d, staffMember }));
    setStepKey("service");
  }

  function selectService(service) {
    // Changing service invalidates style/photo/date/time — duration and style
    // availability all depend on which service was picked.
    clearPhoto();
    setDraft((d) => ({ ...d, service, style: null, referencePhotoPath: null, date: "", slot: null }));
    setStyleMode("choice");
    setSlots(null);
    setStepKey(service.has_styles ? "style" : "date");
  }

  function selectStyleFromList(style) {
    if (draft.referencePhotoPath) clearPhoto(); // mutually exclusive with a reference photo
    setDraft((d) => ({ ...d, style }));
    setStepKey("date");
  }

  function noPreference() {
    clearPhoto();
    setDraft((d) => ({ ...d, style: null, referencePhotoPath: null }));
    setStepKey("date");
  }

  async function handlePickPhotoFile(file) {
    setDraft((d) => ({ ...d, style: null })); // mutually exclusive with a chosen style
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoUploading(true);
    try {
      const path = await uploadReferencePhoto(barber.id, file);
      setDraft((d) => ({ ...d, referencePhotoPath: path }));
    } catch (err) {
      console.error("Reference photo upload failed:", err);
      showToast("Couldn't upload the reference photo.", "err");
      setPhotoPreview(null);
    } finally {
      setPhotoUploading(false);
    }
  }

  function changeDate(date) {
    setDraft((d) => ({ ...d, date, slot: null }));
    setStepKey("time"); // single-tap, same pattern as service/style/no-preference
  }

  function selectSlot(slot) {
    setDraft((d) => ({ ...d, slot }));
  }

  function continueFromTime() {
    if (!draft.slot) return;
    setStepKey("details");
  }

  function updateDetails(patch) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function continueFromDetails() {
    const errors = {};
    if (!draft.name.trim()) errors.name = "Required.";
    if (!draft.phone.trim() || !isValidPhone(draft.phone)) errors.phone = "Enter a valid phone number.";
    if (draft.email.trim() && !isValidEmail(draft.email.trim())) errors.email = "Enter a valid email.";
    setDetailErrors(errors);
    if (Object.keys(errors).length === 0) setStepKey("review");
  }

  async function handleConfirm() {
    if (submitting) return; // guards against double-tap creating a duplicate booking
    setSubmitting(true);
    try {
      const booking = await createBooking({
        barberId: barber.id,
        serviceId: draft.service.id,
        date: draft.date,
        startTime: draft.slot.start.slice(11, 19), // "YYYY-MM-DDTHH:MM:SS" -> "HH:MM:SS"
        hairStyleId: draft.style?.id,
        referencePhotoPath: draft.referencePhotoPath,
        customerName: draft.name.trim(),
        customerPhone: draft.phone.trim(),
        customerEmail: draft.email.trim() || undefined,
        staffId: draft.staffMember?.id,
      });
      setCreatedBooking(booking);

      const methods = withBookingSettingsDefaults(barber.booking_settings).payment_methods;
      const onlinePaymentAvailable =
        withBookingSettingsDefaults(barber.booking_settings).online_payments_enabled && (methods.gcash || methods.maya);
      const needsDeposit = booking.payment_status === "pending" && Number(booking.deposit_amount) > 0;

      setStepKey(needsDeposit && onlinePaymentAvailable ? "pay" : "success");
    } catch (err) {
      const message = friendlyBookingError(err);
      showToast(message, "err");
      if (/just booked/i.test(err?.message || "")) {
        // Stale slot — go back to time selection and refresh availability.
        setDraft((d) => ({ ...d, slot: null }));
        setStepKey("time");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePay(method) {
    if (paying || !createdBooking) return;
    setPaying(true);
    try {
      const checkoutUrl = await createCheckoutSession(createdBooking.id, method);
      window.location.href = checkoutUrl; // full redirect to PayMongo's hosted checkout page
    } catch (err) {
      showToast(err.message || "Unable to start payment. Please try again.", "err");
      setPaying(false);
    }
  }

  function handleSkipPay() {
    setStepKey("success");
  }

  if (barber === null) return <NotFound />;
  if (barber === undefined || stepKey === null) {
    return (
      <div className="center-screen">
        <Loader2 className="spinner" size={22} color="var(--brass)" />
      </div>
    );
  }

  if (stepKey === "pay") {
    return (
      <div className="booking-shell">
        <div className="container" style={{ paddingTop: 28 }}>
          <div className="eyebrow">{barber.shop_name}</div>
          <h1 style={{ fontSize: 22, marginTop: 6, marginBottom: 16 }}>Pay your deposit</h1>
          <PayDepositStep
            barber={barber}
            service={draft.service}
            depositAmount={Number(createdBooking.deposit_amount)}
            paying={paying}
            onPay={handlePay}
            onSkip={handleSkipPay}
          />
        </div>
      </div>
    );
  }

  if (stepKey === "success") {
    return (
      <div className="booking-shell">
        <div className="container" style={{ paddingTop: 28 }}>
          <SuccessStep
            barber={barber}
            staffMember={draft.staffMember}
            service={draft.service}
            style={draft.style}
            hasReferencePhoto={!!draft.referencePhotoPath}
            date={draft.date}
            slot={draft.slot}
            name={draft.name}
            phone={draft.phone}
          />
          <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => navigate(`/${username}`)}>
            Back to barber page
          </button>
        </div>
      </div>
    );
  }

  const today = todayLocalISO();
  const maxAdvanceDays = barber.booking_settings?.max_advance_days ?? 30;
  const maxDateISO = addDaysISO(today, maxAdvanceDays);
  const showPhotoContinue = stepKey === "style" && styleMode === "photo" && !!draft.referencePhotoPath && !photoUploading;

  return (
    <div className="booking-shell">
      <div className="container" style={{ paddingTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 17 }}>{barber.shop_name}</span>
          <button className="icon-btn" onClick={() => navigate(`/${username}`)} aria-label="Cancel booking">
            <X size={16} />
          </button>
        </div>

        <StepProgress steps={steps.map((k) => stepLabels[k])} currentIndex={stepIndex} />

        {stepKey === "staff" && <StaffStep staff={staff} selectedId={draft.staffMember?.id} onSelect={selectStaff} />}

        {stepKey === "service" && <ServiceStep services={services} selectedId={draft.service?.id} onSelect={selectService} />}

        {stepKey === "style" && (
          <HaircutDescriptionStep
            mode={styleMode}
            styles={styles}
            selectedStyleId={draft.style?.id ?? null}
            photoPreview={photoPreview}
            photoUploading={photoUploading}
            onChooseStyleMode={() => setStyleMode("style-list")}
            onChoosePhotoMode={() => setStyleMode("photo")}
            onNoPreference={noPreference}
            onSelectStyle={selectStyleFromList}
            onPickPhotoFile={handlePickPhotoFile}
            onRemovePhoto={clearPhoto}
          />
        )}

        {stepKey === "date" && (
          <DateStep
            year={calendarYear}
            month={calendarMonth}
            value={draft.date}
            minDate={today}
            maxDate={maxDateISO}
            maxAdvanceDays={maxAdvanceDays}
            isDateDisabled={isDateDisabled}
            onNavigate={(y, m) => {
              setCalendarYear(y);
              setCalendarMonth(m);
            }}
            onSelect={changeDate}
          />
        )}

        {stepKey === "time" && (
          <TimeStep loading={slotsLoading} slots={slots} error={slotsError} selectedStart={draft.slot?.start} onSelect={selectSlot} />
        )}

        {stepKey === "details" && (
          <DetailsStep name={draft.name} phone={draft.phone} email={draft.email} errors={detailErrors} onChange={updateDetails} />
        )}

        {stepKey === "review" && (
          <ReviewStep
            barber={barber}
            staffMember={draft.staffMember}
            service={draft.service}
            style={draft.style}
            photoPreview={photoPreview}
            date={draft.date}
            slot={draft.slot}
            name={draft.name}
            phone={draft.phone}
            email={draft.email}
          />
        )}
      </div>

      <div className="booking-footer">
        {(stepIndex > 0 || (stepKey === "style" && styleMode !== "choice")) && (
          <button className="btn btn-ghost" onClick={goBack} disabled={submitting}>
            <ArrowLeft size={15} /> Back
          </button>
        )}
        {showPhotoContinue && (
          <button className="btn btn-primary" onClick={() => setStepKey("date")}>
            Continue
          </button>
        )}
        {stepKey === "time" && (
          <button className="btn btn-primary" onClick={continueFromTime} disabled={!draft.slot}>
            Continue
          </button>
        )}
        {stepKey === "details" && (
          <button className="btn btn-primary" onClick={continueFromDetails}>
            Continue
          </button>
        )}
        {stepKey === "review" && (
          <button className="btn btn-primary" onClick={handleConfirm} disabled={submitting}>
            {submitting ? <Loader2 className="spinner" size={16} /> : null}
            {submitting ? "Confirming…" : "Confirm booking"}
          </button>
        )}
      </div>

      <Toast toast={toast} />
    </div>
  );
}