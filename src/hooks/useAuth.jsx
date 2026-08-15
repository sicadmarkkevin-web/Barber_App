import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { getMyBarberProfile } from "../api/barbers";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [barber, setBarber] = useState(null); // null = not onboarded yet (or not a barber)
  const [loading, setLoading] = useState(true);

  const refreshBarber = useCallback(async () => {
    try {
      const b = await getMyBarberProfile();
      setBarber(b);
      return b;
    } catch (e) {
      console.error("Failed to load barber profile", e);
      setBarber(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) await refreshBarber();
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!active) return;
      setSession(newSession);
      if (newSession) {
        await refreshBarber();
      } else {
        setBarber(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [refreshBarber]);

  const value = {
    session,
    user: session?.user ?? null,
    barber,
    isOnboarded: !!barber,
    loading,
    refreshBarber,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
