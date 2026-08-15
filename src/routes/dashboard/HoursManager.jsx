import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Copy } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { getWeeklyHours, saveWeeklyHours } from "../../api/hours";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/shared/Toast";

const WEEKDAY_NUMS = [1, 2, 3, 4, 5]; // Mon-Fri, for "copy to all weekdays"

export default function HoursManager() {
  const { barber } = useAuth();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const [days, setDays] = useState(null); // null = loading
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({}); // { [day_of_week]: message }

  useEffect(() => {
    if (!barber) return;
    let active = true;
    getWeeklyHours(barber.id)
      .then((data) => active && setDays(data))
      .catch((err) => active && setLoadError(err.message || "Couldn't load your business hours."));
    return () => {
      active = false;
    };
  }, [barber]);

  function updateDay(day_of_week, patch) {
    setDays((prev) => prev.map((d) => (d.day_of_week === day_of_week ? { ...d, ...patch } : d)));
    setErrors((prev) => ({ ...prev, [day_of_week]: undefined }));
  }

  function copyMondayToWeekdays() {
    const monday = days.find((d) => d.day_of_week === 1);
    if (!monday) return;
    setDays((prev) =>
      prev.map((d) =>
        WEEKDAY_NUMS.includes(d.day_of_week)
          ? { ...d, is_closed: monday.is_closed, open_time: monday.open_time, close_time: monday.close_time }
          : d
      )
    );
    setErrors({});
  }

  function validate() {
    const next = {};
    for (const d of days) {
      if (!d.is_closed && d.open_time >= d.close_time) {
        next[d.day_of_week] = "Opening time must be earlier than closing time.";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      await saveWeeklyHours(barber.id, days);
      showToast("Business hours saved.");
    } catch (err) {
      showToast(err.message || "Couldn't save your business hours.", "err");
    } finally {
      setSaving(false);
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

      <div className="eyebrow">Your public page</div>
      <h1 style={{ fontSize: 24, marginTop: 6 }}>Business hours</h1>

      {days === null && !loadError && (
        <p style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
          <Loader2 className="spinner" size={16} /> Loading hours…
        </p>
      )}

      {loadError && <p className="error-text" style={{ marginTop: 18 }}>{loadError}</p>}

      {days && (
        <>
          <button
            className="btn btn-ghost"
            style={{ width: "auto", padding: "8px 12px", marginTop: 18 }}
            onClick={copyMondayToWeekdays}
            disabled={saving}
          >
            <Copy size={14} /> Copy Monday to all weekdays
          </button>

          <div className="card" style={{ marginTop: 14 }}>
            {days.map((d, i) => (
              <div key={d.day_of_week} style={{ paddingTop: i === 0 ? 0 : 16, marginTop: i === 0 ? 0 : 16, borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                <div className="switch-row">
                  <span style={{ fontWeight: 600 }}>{d.label}</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={!d.is_closed}
                      onChange={(e) => updateDay(d.day_of_week, { is_closed: !e.target.checked })}
                      disabled={saving}
                    />
                    <span className="switch-track" onClick={() => !saving && updateDay(d.day_of_week, { is_closed: !d.is_closed })} />
                  </span>
                </div>

                {d.is_closed ? (
                  <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13.5 }}>Closed</p>
                ) : (
                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: 12 }}>Opening</label>
                      <input
                        type="time"
                        value={d.open_time}
                        onChange={(e) => updateDay(d.day_of_week, { open_time: e.target.value })}
                        disabled={saving}
                      />
                    </div>
                    <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                      <label style={{ fontSize: 12 }}>Closing</label>
                      <input
                        type="time"
                        value={d.close_time}
                        onChange={(e) => updateDay(d.day_of_week, { close_time: e.target.value })}
                        disabled={saving}
                      />
                    </div>
                  </div>
                )}
                {errors[d.day_of_week] && <p className="error-text">{errors[d.day_of_week]}</p>}
              </div>
            ))}
          </div>

          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="spinner" size={16} /> : null}
            {saving ? "Saving…" : "Save hours"}
          </button>
        </>
      )}

      <Toast toast={toast} />
    </div>
  );
}
