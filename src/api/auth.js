import { supabase } from "../lib/supabaseClient";

/**
 * Registers a new barber account. Creates the auth user, then the matching
 * `profiles` row. The `barbers` row itself isn't created here — that happens
 * at the end of the onboarding wizard once we have a confirmed username.
 */
export async function signUpBarber({ email, password, fullName, phone }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, phone, role: "barber" },
    },
  });
  if (error) throw error;

  // The profiles row is created by a DB trigger (see migration 0001), which
  // runs as SECURITY DEFINER and always succeeds regardless of session state.
  //
  // We only mirror it with a client-side upsert when signUp() returned an
  // active session (i.e. email confirmation is off and we're already signed
  // in) — that upsert runs as the anon role otherwise (no session yet means
  // no auth.uid()), which the "profiles: insert own" RLS policy always
  // rejects. When there's no session, skip it and rely on the trigger.
  if (data.user && data.session) {
    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        id: data.user.id,
        role: "barber",
        full_name: fullName,
        phone,
        email,
      },
      { onConflict: "id" }
    );
    if (profileError) throw profileError;
  }

  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/login`,
  });
  if (error) throw error;
}

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}