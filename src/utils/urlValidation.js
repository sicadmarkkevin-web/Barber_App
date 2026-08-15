/**
 * Validates an optional URL field. Empty is always valid (these fields are optional
 * per the brief — never force a barber to have social accounts). When something is
 * entered, it must parse as a URL; bare handles like "@juanbarber" are rejected with
 * a clear reason rather than silently accepted as garbage.
 */
export function validateOptionalUrl(raw) {
  const value = (raw || "").trim();
  if (!value) return { ok: true, value: "" };

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) throw new Error("no host");
    return { ok: true, value: withScheme };
  } catch {
    return { ok: false, reason: "Enter a valid link, e.g. facebook.com/yourpage" };
  }
}
