export default function StepProgress({ steps, currentIndex }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="eyebrow">
        Step {currentIndex + 1} of {steps.length} — {steps[currentIndex]}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        {steps.map((label, i) => (
          <div
            key={label}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 999,
              background: i <= currentIndex ? "var(--brass)" : "var(--border)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
