import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Camera, Facebook, Instagram, MessageCircle, Globe, ArrowLeft } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { updateMyBarberProfile } from "../../api/barbers";
import { uploadImage } from "../../utils/image";
import { validateOptionalUrl } from "../../utils/urlValidation";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/shared/Toast";

// A minimal TikTok glyph — lucide-react doesn't ship one.
function TikTokIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.6 5.8c-.9-.9-1.4-2.1-1.5-3.5h-3.2v13.3c0 1.5-1.2 2.7-2.7 2.7s-2.7-1.2-2.7-2.7 1.2-2.7 2.7-2.7c.3 0 .6.1.9.2V9.9c-.3 0-.6-.1-.9-.1-3.2 0-5.9 2.6-5.9 5.9s2.6 5.9 5.9 5.9 5.9-2.6 5.9-5.9V9c1.2.9 2.7 1.4 4.3 1.4V7.2c-1 0-1.9-.3-2.8-.9z" />
    </svg>
  );
}

export default function EditProfile() {
  const { barber, refreshBarber } = useAuth();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();
  const fileInputRef = useRef(null);

  const [shopName, setShopName] = useState(barber?.shop_name || "");
  const [bio, setBio] = useState(barber?.bio || "");
  const [phone, setPhone] = useState(barber?.phone || "");
  const [facebookUrl, setFacebookUrl] = useState(barber?.facebook_url || "");
  const [instagramUrl, setInstagramUrl] = useState(barber?.instagram_url || "");
  const [tiktokUrl, setTiktokUrl] = useState(barber?.tiktok_url || "");
  const [messengerUrl, setMessengerUrl] = useState(barber?.messenger_url || "");
  const [websiteUrl, setWebsiteUrl] = useState(barber?.website_url || "");

  const [photoPreview, setPhotoPreview] = useState(barber?.profile_image_url || "");
  const [pendingFile, setPendingFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");

  if (!barber) {
    // Guarded by RequireOnboarded at the route level, but keep this defensive —
    // there's nothing sensible to render without a barber row loaded yet.
    return (
      <div className="center-screen">
        <Loader2 className="spinner" size={22} color="var(--brass)" />
      </div>
    );
  }

  function handlePhotoPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.", "err");
      return;
    }
    setPendingFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function validate() {
    const next = {};
    if (!shopName.trim()) next.shopName = "Required.";

    const fb = validateOptionalUrl(facebookUrl);
    if (!fb.ok) next.facebookUrl = fb.reason;
    const ig = validateOptionalUrl(instagramUrl);
    if (!ig.ok) next.instagramUrl = ig.reason;
    const tt = validateOptionalUrl(tiktokUrl);
    if (!tt.ok) next.tiktokUrl = tt.reason;
    const ms = validateOptionalUrl(messengerUrl);
    if (!ms.ok) next.messengerUrl = ms.reason;
    const wb = validateOptionalUrl(websiteUrl);
    if (!wb.ok) next.websiteUrl = wb.reason;

    setErrors(next);
    return { ok: Object.keys(next).length === 0, normalized: { fb, ig, tt, ms, wb } };
  }

  async function handleSave(e) {
    e.preventDefault();
    setFormError("");

    const { ok, normalized } = validate();
    if (!ok) return;

    setSaving(true);
    try {
      let profileImageUrl = barber.profile_image_url;

      if (pendingFile) {
        setUploading(true);
        try {
          // Fixed path per barber (upsert: true in uploadImage) — replacing a
          // photo overwrites the same file instead of piling up orphans.
          profileImageUrl = await uploadImage("profile-images", `${barber.id}/avatar.jpg`, pendingFile);
        } catch (err) {
          console.error("Profile photo upload failed:", err);
          setFormError("Couldn't upload your profile photo. Please try again.");
          setUploading(false);
          setSaving(false);
          return;
        }
        setUploading(false);
      }

      await updateMyBarberProfile(barber.id, {
        shop_name: shopName.trim(),
        bio: bio.trim(),
        phone: phone.trim(),
        facebook_url: normalized.fb.value,
        instagram_url: normalized.ig.value,
        tiktok_url: normalized.tt.value,
        messenger_url: normalized.ms.value,
        website_url: normalized.wb.value,
        profile_image_url: profileImageUrl,
      });

      await refreshBarber();
      setPendingFile(null);
      showToast("Profile saved.");
    } catch (err) {
      console.error("Couldn't save profile:", err);
      setFormError(err.message || "Couldn't save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || uploading;

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
      <h1 style={{ fontSize: 24, marginTop: 6 }}>Edit profile</h1>

      <form className="card" style={{ marginTop: 18 }} onSubmit={handleSave}>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoPick} />
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
        <button type="button" className="change-photo-btn" onClick={() => !busy && fileInputRef.current?.click()} disabled={busy}>
          {photoPreview ? "Change photo" : "Add photo"}
        </button>

        <div className="field" style={{ marginTop: 22 }}>
          <label htmlFor="shopName">Barber / shop name</label>
          <input id="shopName" type="text" value={shopName} onChange={(e) => setShopName(e.target.value)} disabled={busy} />
          {errors.shopName && <p className="error-text">{errors.shopName}</p>}
        </div>

        <div className="field">
          <label htmlFor="bio">Bio</label>
          <textarea id="bio" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} disabled={busy} placeholder="Professional fades and modern men's cuts..." />
        </div>

        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} placeholder="09XXXXXXXXX" />
        </div>

        <div className="eyebrow" style={{ marginTop: 6, marginBottom: 14 }}>Social links (all optional)</div>

        <div className="social-field">
          <div className="social-field-icon"><Facebook size={17} /></div>
          <div className="social-field-input">
            <input type="text" value={facebookUrl} onChange={(e) => setFacebookUrl(e.target.value)} disabled={busy} placeholder="facebook.com/yourpage" />
            {errors.facebookUrl && <p className="error-text">{errors.facebookUrl}</p>}
          </div>
        </div>

        <div className="social-field">
          <div className="social-field-icon"><Instagram size={17} /></div>
          <div className="social-field-input">
            <input type="text" value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} disabled={busy} placeholder="instagram.com/yourhandle" />
            {errors.instagramUrl && <p className="error-text">{errors.instagramUrl}</p>}
          </div>
        </div>

        <div className="social-field">
          <div className="social-field-icon"><TikTokIcon size={16} /></div>
          <div className="social-field-input">
            <input type="text" value={tiktokUrl} onChange={(e) => setTiktokUrl(e.target.value)} disabled={busy} placeholder="tiktok.com/@yourhandle" />
            {errors.tiktokUrl && <p className="error-text">{errors.tiktokUrl}</p>}
          </div>
        </div>

        <div className="social-field">
          <div className="social-field-icon"><MessageCircle size={17} /></div>
          <div className="social-field-input">
            <input type="text" value={messengerUrl} onChange={(e) => setMessengerUrl(e.target.value)} disabled={busy} placeholder="m.me/yourpage" />
            {errors.messengerUrl && <p className="error-text">{errors.messengerUrl}</p>}
          </div>
        </div>

        <div className="social-field" style={{ marginBottom: 6 }}>
          <div className="social-field-icon"><Globe size={17} /></div>
          <div className="social-field-input">
            <input type="text" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} disabled={busy} placeholder="yourshop.com" />
            {errors.websiteUrl && <p className="error-text">{errors.websiteUrl}</p>}
          </div>
        </div>

        {formError && <p className="error-text">{formError}</p>}

        <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? <Loader2 className="spinner" size={16} /> : null}
          {uploading ? "Uploading photo…" : saving ? "Saving…" : "Save profile"}
        </button>
      </form>

      <Toast toast={toast} />
    </div>
  );
}
