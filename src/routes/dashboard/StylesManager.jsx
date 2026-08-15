import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Pencil, Trash2, Plus } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { listStylesForBarber, createStyle, updateStyle, deleteStyle, deleteStyleImage } from "../../api/styles";
import { uploadImage } from "../../utils/image";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/shared/Toast";
import ConfirmDialog from "../../components/shared/ConfirmDialog";
import HairIcon, { HAIR_ICON_TYPES } from "../../components/shared/HairIcon";

function StyleForm({ initial, saving, onCancel, onSave }) {
  const [name, setName] = useState(initial.name || "");
  const [icon, setIcon] = useState(initial.icon || "fade");
  const [imagePreview, setImagePreview] = useState(initial.image_url || "");
  const [pendingFile, setPendingFile] = useState(null);
  const [errors, setErrors] = useState({});
  const fileInputRef = useRef(null);

  function handlePhotoPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrors((prev) => ({ ...prev, image: "Please choose an image file." }));
      return;
    }
    setErrors((prev) => ({ ...prev, image: undefined }));
    setPendingFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function validate() {
    const next = {};
    if (!name.trim()) next.name = "Required.";
    setErrors((prev) => ({ ...prev, ...next, name: next.name }));
    return !next.name;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    onSave({ name: name.trim(), icon, pendingFile });
  }

  return (
    <div className="overlay-backdrop" onClick={onCancel}>
      <form className="overlay-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 style={{ fontSize: 18, marginBottom: 16 }}>{initial.id ? "Edit style" : "Add style"}</h3>

        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoPick} disabled={saving} />
        <button
          type="button"
          className="style-thumb-btn"
          style={{ maxWidth: 140, margin: "0 auto", display: "flex" }}
          onClick={() => !saving && fileInputRef.current?.click()}
        >
          {imagePreview ? (
            <div style={{ width: "100%", height: "100%", backgroundImage: `url(${imagePreview})`, backgroundSize: "cover", backgroundPosition: "center" }} />
          ) : (
            <HairIcon type={icon} size={44} />
          )}
        </button>
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button type="button" className="change-photo-btn" onClick={() => !saving && fileInputRef.current?.click()}>
            {imagePreview ? "Change photo" : "Add photo (optional)"}
          </button>
        </div>
        {errors.image && <p className="error-text" style={{ textAlign: "center" }}>{errors.image}</p>}

        <div className="field" style={{ marginTop: 18 }}>
          <label htmlFor="style-name">Style name</label>
          <input id="style-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Low Fade" disabled={saving} />
          {errors.name && <p className="error-text">{errors.name}</p>}
        </div>

        <div className="field">
          <label>Icon (used when there's no photo)</label>
          <div className="icon-picker-grid">
            {HAIR_ICON_TYPES.map((t) => (
              <button
                type="button"
                key={t}
                className={`icon-picker-btn ${icon === t ? "selected" : ""}`}
                onClick={() => setIcon(t)}
                disabled={saving}
                aria-label={t}
                title={t}
              >
                <HairIcon type={t} size={24} />
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 className="spinner" size={16} /> : null}
            {saving ? "Saving…" : "Save style"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function StylesManager() {
  const { barber } = useAuth();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const [styles, setStyles] = useState(null); // null = loading
  const [loadError, setLoadError] = useState("");
  const [formTarget, setFormTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!barber) return;
    let active = true;
    listStylesForBarber(barber.id)
      .then((data) => active && setStyles(data))
      .catch((err) => active && setLoadError(err.message || "Couldn't load your styles."));
    return () => {
      active = false;
    };
  }, [barber]);

  async function handleSave({ name, icon, pendingFile }) {
    setSaving(true);
    try {
      const isEdit = !!formTarget.id;
      const id = isEdit ? formTarget.id : crypto.randomUUID();
      let imageUrl = isEdit ? formTarget.image_url || null : null;

      if (pendingFile) {
        try {
          imageUrl = await uploadImage("style-images", `${barber.id}/${id}.jpg`, pendingFile);
        } catch (err) {
          console.error("Style photo upload failed:", err);
          showToast("Couldn't upload the style photo.", "err");
          setSaving(false);
          return;
        }
      }

      if (isEdit) {
        const updated = await updateStyle(id, { name, icon, imageUrl });
        setStyles((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        showToast("Style updated.");
      } else {
        const created = await createStyle(barber.id, { id, name, icon, imageUrl });
        setStyles((prev) => [...prev, created]);
        showToast("Style added.");
      }
      setFormTarget(null);
    } catch (err) {
      showToast(err.message || "Couldn't save this style.", "err");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      if (pendingDelete.image_url) {
        await deleteStyleImage(barber.id, pendingDelete.id);
      }
      await deleteStyle(pendingDelete.id);
      setStyles((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      showToast("Style deleted.");
      setPendingDelete(null);
    } catch (err) {
      showToast(err.message || "Couldn't delete this style.", "err");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="container-wide" style={{ paddingTop: 28, paddingBottom: 48 }}>
      <button
        className="btn btn-ghost"
        style={{ width: "auto", padding: "8px 12px", marginBottom: 18 }}
        onClick={() => navigate("/dashboard")}
      >
        <ArrowLeft size={15} /> Dashboard
      </button>

      <div className="eyebrow">Your public page</div>
      <h1 style={{ fontSize: 24, marginTop: 6 }}>Haircut styles</h1>

      {styles === null && !loadError && (
        <p style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
          <Loader2 className="spinner" size={16} /> Loading styles…
        </p>
      )}

      {loadError && <p className="error-text" style={{ marginTop: 18 }}>{loadError}</p>}

      {styles && styles.length === 0 && (
        <p style={{ marginTop: 18 }}>You haven't added any styles yet. Add your first one below.</p>
      )}

      {styles && styles.length > 0 && (
        <div className="style-grid" style={{ marginTop: 20 }}>
          {styles.map((s) => (
            <div className="style-card" key={s.id}>
              <div
                className="style-thumb"
                style={s.image_url ? { backgroundImage: `url(${s.image_url})` } : undefined}
              >
                {!s.image_url && <HairIcon type={s.icon || "fade"} size={38} />}
              </div>
              <div className="style-name">{s.name}</div>
              <div className="style-card-actions">
                <button
                  className="icon-btn"
                  onClick={() => setFormTarget({ id: s.id, name: s.name, icon: s.icon, image_url: s.image_url })}
                  aria-label={`Edit ${s.name}`}
                >
                  <Pencil size={14} />
                </button>
                <button className="icon-btn icon-btn-danger" onClick={() => setPendingDelete(s)} aria-label={`Delete ${s.name}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ marginTop: 20, width: "auto", padding: "12px 20px" }}
        onClick={() => setFormTarget({ name: "", icon: "fade", image_url: "" })}
      >
        <Plus size={16} /> Add style
      </button>

      {formTarget && (
        <StyleForm initial={formTarget} saving={saving} onCancel={() => setFormTarget(null)} onSave={handleSave} />
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
