import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Pencil, Trash2, Plus } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { listServicesForBarber, createService, updateService, deleteService } from "../../api/services";
import { formatPHP } from "../../utils/currency";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/shared/Toast";
import ConfirmDialog from "../../components/shared/ConfirmDialog";

const BLANK_FORM = { name: "", price: "", durationMinutes: "", hasStyles: false };

function ServiceForm({ initial, saving, onCancel, onSave }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});

  function validate() {
    const next = {};
    if (!form.name.trim()) next.name = "Required.";
    const price = Number(form.price);
    if (form.price === "" || Number.isNaN(price) || price < 0) next.price = "Enter a valid price (0 or more).";
    const duration = Number(form.durationMinutes);
    if (form.durationMinutes === "" || !Number.isInteger(duration) || duration <= 0) {
      next.durationMinutes = "Enter a duration in minutes, greater than 0.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    onSave({
      name: form.name.trim(),
      price: Number(form.price),
      durationMinutes: Math.round(Number(form.durationMinutes)),
      hasStyles: form.hasStyles,
    });
  }

  return (
    <div className="overlay-backdrop" onClick={onCancel}>
      <form className="overlay-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 style={{ fontSize: 18, marginBottom: 16 }}>{initial.id ? "Edit service" : "Add service"}</h3>

        <div className="field">
          <label htmlFor="svc-name">Service name</label>
          <input
            id="svc-name"
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Haircut"
            disabled={saving}
          />
          {errors.name && <p className="error-text">{errors.name}</p>}
        </div>

        <div className="field">
          <label htmlFor="svc-price">Price (₱)</label>
          <input
            id="svc-price"
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            placeholder="200"
            disabled={saving}
          />
          {errors.price && <p className="error-text">{errors.price}</p>}
        </div>

        <div className="field">
          <label htmlFor="svc-duration">Duration (minutes)</label>
          <input
            id="svc-duration"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={form.durationMinutes}
            onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
            placeholder="30"
            disabled={saving}
          />
          {errors.durationMinutes && <p className="error-text">{errors.durationMinutes}</p>}
        </div>

        <div className="field">
          <div className="switch-row">
            <label htmlFor="svc-styles" style={{ marginBottom: 0 }}>
              Let customers choose a hairstyle for this service
            </label>
            <span className="switch">
              <input
                id="svc-styles"
                type="checkbox"
                checked={form.hasStyles}
                onChange={(e) => setForm({ ...form, hasStyles: e.target.checked })}
                disabled={saving}
              />
              <span className="switch-track" onClick={() => !saving && setForm((f) => ({ ...f, hasStyles: !f.hasStyles }))} />
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 className="spinner" size={16} /> : null}
            {saving ? "Saving…" : "Save service"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ServicesManager() {
  const { barber } = useAuth();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const [services, setServices] = useState(null); // null = loading
  const [loadError, setLoadError] = useState("");
  const [formTarget, setFormTarget] = useState(null); // null closed, {} = new, {...service} = edit
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!barber) return;
    let active = true;
    listServicesForBarber(barber.id)
      .then((data) => active && setServices(data))
      .catch((err) => active && setLoadError(err.message || "Couldn't load your services."));
    return () => {
      active = false;
    };
  }, [barber]);

  async function handleSave(values) {
    setSaving(true);
    try {
      if (formTarget.id) {
        const updated = await updateService(formTarget.id, values);
        setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        showToast("Service updated.");
      } else {
        const created = await createService(barber.id, values);
        setServices((prev) => [...prev, created]);
        showToast("Service added.");
      }
      setFormTarget(null);
    } catch (err) {
      showToast(err.message || "Couldn't save this service.", "err");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteService(pendingDelete.id);
      setServices((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      showToast("Service deleted.");
      setPendingDelete(null);
    } catch (err) {
      showToast(err.message || "Couldn't delete this service.", "err");
    } finally {
      setDeleting(false);
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
      <h1 style={{ fontSize: 24, marginTop: 6 }}>Services</h1>

      <div className="card" style={{ marginTop: 18 }}>
        {services === null && !loadError && (
          <p style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
            <Loader2 className="spinner" size={16} /> Loading services…
          </p>
        )}

        {loadError && <p className="error-text">{loadError}</p>}

        {services && services.length === 0 && (
          <p style={{ margin: 0 }}>You haven't added any services yet. Add your first one below.</p>
        )}

        {services && services.length > 0 && (
          <div>
            {services.map((s) => (
              <div className="service-row" key={s.id}>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>
                    {formatPHP(s.price)} · {s.duration_minutes} min{s.has_styles ? " · style selectable" : ""}
                  </div>
                </div>
                <div className="service-row-actions">
                  <button
                    className="icon-btn"
                    onClick={() =>
                      setFormTarget({
                        id: s.id,
                        name: s.name,
                        price: String(s.price),
                        durationMinutes: String(s.duration_minutes),
                        hasStyles: s.has_styles,
                      })
                    }
                    aria-label={`Edit ${s.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button className="icon-btn icon-btn-danger" onClick={() => setPendingDelete(s)} aria-label={`Delete ${s.name}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setFormTarget({ ...BLANK_FORM })}>
        <Plus size={16} /> Add service
      </button>

      {formTarget && (
        <ServiceForm initial={formTarget} saving={saving} onCancel={() => setFormTarget(null)} onSave={handleSave} />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}"?`}
          body="This can't be undone."
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDelete}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}
