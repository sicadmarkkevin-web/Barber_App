export const RESERVED_USERNAMES = (
  import.meta.env.VITE_RESERVED_USERNAMES ||
  "admin,login,signup,onboarding,dashboard,settings,pricing,support,api,about,terms,privacy"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

/**
 * Validates a candidate username's shape and reserved-word status only.
 * Uniqueness against the database is checked separately (see api/barbers.js),
 * since that requires a network round-trip.
 */
export function validateUsernameFormat(raw) {
  const username = (raw || "").trim().toLowerCase();
  if (username.length < 3) return { ok: false, reason: "Must be at least 3 characters." };
  if (username.length > 30) return { ok: false, reason: "Must be 30 characters or fewer." };
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      reason: "Use only lowercase letters, numbers, and hyphens. Can't start or end with a hyphen.",
    };
  }
  if (RESERVED_USERNAMES.includes(username)) {
    return { ok: false, reason: "That name is reserved. Try another." };
  }
  return { ok: true, username };
}
