// Ported from the original app's HairIcon component (booking-app.jsx). Used as a
// themed placeholder for styles that don't have an uploaded photo. var(--gold) in
// the original maps to var(--brass) here; --bg/--surface/--border already match.

export const HAIR_ICON_TYPES = [
  "fade",
  "taper",
  "undercut",
  "mohawk",
  "flattop",
  "hardpart",
  "bald",
  "spiky",
  "messy",
  "fringe",
];

export default function HairIcon({ type, size = 30 }) {
  const hair = (() => {
    switch (type) {
      case "fade":
        return <path d="M11 13 Q20 4.5 29 13 Q28.5 9.5 20 8.3 Q11.5 9.5 11 13 Z" />;
      case "taper":
        return <path d="M10 14 Q20 2.5 30 14 Q29 8.5 20 6.8 Q11 8.5 10 14 Z" />;
      case "undercut":
        return (
          <>
            <path d="M14 12.5 Q20 3 26 12.5 Q23.5 7.5 20 7.3 Q16.5 7.5 14 12.5 Z" />
            <line x1="11" y1="16" x2="29" y2="16" strokeWidth="1.4" stroke="var(--brass)" strokeLinecap="round" />
          </>
        );
      case "mohawk":
        return (
          <>
            <path d="M18 13 L20 1.5 L22 13 Z" />
            <path d="M12 14 Q20 12 28 14 Q28 15.5 20 15.5 Q12 15.5 12 14 Z" opacity="0.55" />
          </>
        );
      case "flattop":
        return <rect x="12" y="4.5" width="16" height="6.5" rx="1.2" />;
      case "hardpart":
        return (
          <>
            <path d="M11 13.5 Q20 4 29 13.5 Q28.5 9.5 20 8 Q11.5 9.5 11 13.5 Z" />
            <line x1="16" y1="8.6" x2="13.3" y2="13" strokeWidth="1.3" stroke="var(--bg)" strokeLinecap="round" />
          </>
        );
      case "bald":
        return <ellipse cx="16.5" cy="9.5" rx="2.6" ry="1.6" opacity="0.35" transform="rotate(-25 16.5 9.5)" />;
      case "spiky":
        return (
          <>
            <path d="M12 13 L14 5 L16.5 12" />
            <path d="M16.5 12 L19 3.5 L21.5 12" />
            <path d="M21.5 12 L24.5 5.5 L27 13" />
          </>
        );
      case "messy":
        return <path d="M11 14 Q13 6 17 10 Q19 3.5 22 9 Q25 5 28 12 Q29 15 25 14 Q20 16.5 16 14 Q12 16 11 14 Z" />;
      case "fringe":
        return <path d="M10.5 15 Q11 6 20 6.5 Q29 6 29.5 15 Q26 11 20 12 Q14 11 10.5 15 Z" />;
      default:
        return <path d="M11 13 Q20 4.5 29 13 Q28.5 9.5 20 8.3 Q11.5 9.5 11 13 Z" />;
    }
  })();

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <path d="M8 38 Q8 25.5 20 25.5 Q32 25.5 32 38 Z" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.2" />
      <circle cx="20" cy="18" r="9.2" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.2" />
      <g fill="var(--brass)" stroke="var(--brass)" strokeWidth="1" strokeLinejoin="round">
        {hair}
      </g>
    </svg>
  );
}
