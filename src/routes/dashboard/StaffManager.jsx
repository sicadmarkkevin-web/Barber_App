import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Loader2, Pencil, Trash2, Plus, Clock, Camera } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { listStaffForBarber, createStaff, updateStaff, deleteStaff, deleteStaffImage } from "../../api/staff";
import { uploadImage } from "../../utils/image";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/shared/Toast";
import ConfirmDialog from "../../components/shared/ConfirmDialog";

const BLANK_FORM = { name: "", bio: "", photoUrl: "", active: true };

function StaffForm({ initial, saving, uploading, onCancel, onSave }) {
  const [form, setForm] = useState(initial);
  const [photoPreview, setPhotoPreview] = useState(initial.photoUrl || "");
  const [pendingFile, setPendingFile] = useState(null);
  const [errors, setErrors] = useState({});
  const fileInputRef = useRef(null);
  const busy = saving || uploading;

  function handlePhotoPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrors((prev) => ({ ...prev, photo: "Please choose an image file." }));
      return;
    }
    setErrors((prev) => ({ ...prev, photo: undefined }));
    setPendingFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function validate() {
    const next = {};
    if (!form.name.trim()) next.name = "Required.";
    setErrors((prev) => ({ ...prev, ...next }));
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    onSave({
      name: form.name.trim(),
      bio: form.bio.trim(),
      active: form.active,
      photoFile: pendingFile,
    });
  }

  return (
    <div className="overlay-backdrop" onClick={onCancel}>
      <form className="overlay-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 style={{ fontSize: 18, marginBottom: 16 }}>{initial.id ? "Edit staff member" : "Add staff member"}</h3>

        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoPick} />
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            className="avatar-picker"
            style={{ backgroundImage: photoPreview ? `url(${photoPreview})` : "none" }}
            onClick={() => !busy && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            {!photoPreview && <Camera size={26} />}
            {uploading && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Loader2 className="spinner" size={20} color="#fff" />
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button type="button" className="change-photo-btn" onClick={() => !busy && fileInputRef.current?.click()} disabled={busy}>
            {photoPreview ? "Change photo" : "Add photo"}
          </button>
        </div>
        {errors.photo && <p className="error-text" style={{ textAlign: "center" }}>{errors.photo}</p>}

        <div className="field" style={{ marginTop: 18 }}>
          <label htmlFor="staff-name">Name</label>
          <input
            id="staff-name"
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Jun Dela Cruz"
            disabled={busy}
          />
          {errors.name && <p className="error-text">{errors.name}</p>}
        </div>

        <div className="field">
          <label htmlFor="staff-bio">Short bio (optional)</label>
          <input
            id="staff-bio"
            type="text"
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            placeholder="Specializes in fades and tapers"
            disabled={busy}
          />
        </div>

        {initial.id && (
          <div className="field">
            <div className="switch-row">
              <label htmlFor="staff-active" style={{ marginBottom: 0 }}>
                Visible to customers
              </label>
              <span className="switch">
                <input
                  id="staff-active"
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  disabled={busy}
                />
                <span className="switch-track" onClick={() => !busy && setForm((f) => ({ ...f, active: !f.active }))} />
              </span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Loader2 className="spinner" size={16} /> : null}
            {uploading ? "Uploading photo…" : saving ? "Saving…" : "Save staff member"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function StaffManager() {
  const { barber } = useAuth();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const [staff, setStaff] = useState(null); // null = loading
  const [loadError, setLoadError] = useState("");
  const [formTarget, setFormTarget] = useState(null); // null closed, {} = new, {...staff} = edit
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!barber) return;
    let active = true;
    listStaffForBarber(barber.id)
      .then((data) => active && setStaff(data))
      .catch((err) => active && setLoadError(err.message || "Couldn't load your staff."));
    return () => {
      active = false;
    };
  }, [barber]);

  async function handleSave({ name, bio, active, photoFile }) {
    setSaving(true);
    try {
      // A staff id is needed up front so an uploaded photo has somewhere
      // stable to live, even for a brand-new staff member that doesn't have
      // a row yet — the same fixed-path-per-subject convention EditProfile
      // uses for the barber's own avatar (".../avatar.jpg"), just one level
      // deeper so replacing a photo overwrites instead of piling up orphans.
      const staffId = formTarget.id || crypto.randomUUID();
      let photoUrl = formTarget.photoUrl || null;

      if (photoFile) {
        setUploading(true);
        try {
          photoUrl = await uploadImage("profile-images", `${barber.id}/staff/${staffId}.jpg`, photoFile);
        } catch (err) {
          console.error("Staff photo upload failed:", err);
          showToast(err.message || "Couldn't upload that photo.", "err");
          setUploading(false);
          setSaving(false);
          return;
        }
        setUploading(false);
      }

      if (formTarget.id) {
        const updated = await updateStaff(formTarget.id, { name, bio, photoUrl, active });
        setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        showToast("Staff member updated.");
      } else {
        const created = await createStaff(barber.id, { id: staffId, name, bio, photoUrl });
        setStaff((prev) => [...prev, created]);
        showToast("Staff member added.");
      }
      setFormTarget(null);
    } catch (err) {
      showToast(err.message || "Couldn't save this staff member.", "err");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      if (pendingDelete.photo_url) {
        await deleteStaffImage(barber.id, pendingDelete.id);
      }
      await deleteStaff(pendingDelete.id);
      setStaff((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      showToast("Staff member removed.");
      setPendingDelete(null);
    } catch (err) {
      showToast(err.message || "Couldn't remove this staff member.", "err");
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

      <div className="eyebrow">Your shop</div>
      <h1 style={{ fontSize: 24, marginTop: 6 }}>Staff</h1>
      <p style={{ marginTop: 6 }}>Customers will be able to pick who they want to book with.</p>

      <div className="card" style={{ marginTop: 18 }}>
        {staff === null && !loadError && (
          <p style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
            <Loader2 className="spinner" size={16} /> Loading staff…
          </p>
        )}

        {loadError && <p className="error-text">{loadError}</p>}

        {staff && staff.length === 0 && (
          <p style={{ margin: 0 }}>You haven't added any staff yet. Add your first one below.</p>
        )}

        {staff && staff.length > 0 && (
          <div>
            {staff.map((s) => (
              <div className="service-row" key={s.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: "var(--surface-raised)",
                      border: "1px solid var(--border)",
                      backgroundImage: s.photo_url ? `url(${s.photo_url})` : "none",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {s.name}
                      {!s.active && <span style={{ color: "var(--muted)", fontWeight: 400 }}> · hidden</span>}
                    </div>
                    {s.bio && <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>{s.bio}</div>}
                  </div>
                </div>
                <div className="service-row-actions">
                  <Link className="icon-btn" to={`/dashboard/staff/${s.id}/hours`} aria-label={`Edit ${s.name}'s hours`}>
                    <Clock size={15} />
                  </Link>
                  <button
                    className="icon-btn"
                    onClick={() =>
                      setFormTarget({
                        id: s.id,
                        name: s.name,
                        bio: s.bio || "",
                        photoUrl: s.photo_url || "",
                        active: s.active,
                      })
                    }
                    aria-label={`Edit ${s.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button className="icon-btn icon-btn-danger" onClick={() => setPendingDelete(s)} aria-label={`Remove ${s.name}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setFormTarget({ ...BLANK_FORM })}>
        <Plus size={16} /> Add staff member
      </button>

      {formTarget && (
        <StaffForm
          initial={formTarget}
          saving={saving}
          uploading={uploading}
          onCancel={() => !saving && !uploading && setFormTarget(null)}
          onSave={handleSave}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Remove "${pendingDelete.name}"?`}
          body="This can't be undone. Past bookings assigned to them are kept, just unassigned."
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDelete}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}