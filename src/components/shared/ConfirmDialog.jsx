export default function ConfirmDialog({ title, body, confirmLabel = "Delete", busy, onConfirm, onCancel }) {
  return (
    <div className="overlay-backdrop" onClick={onCancel}>
      <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18 }}>{title}</h3>
        {body && <p style={{ marginTop: 8 }}>{body}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
