import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";

function CenteredSpinner() {
  return (
    <div className="center-screen">
      <Loader2 className="spinner" size={22} color="var(--brass)" />
    </div>
  );
}

/** Requires a signed-in user. Sends anonymous visitors to /login and remembers where they were going. */
export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <CenteredSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

/** Requires a signed-in user who has finished onboarding (i.e. has a barbers row). */
export function RequireOnboarded({ children }) {
  const { user, loading, isOnboarded } = useAuth();
  const location = useLocation();
  if (loading) return <CenteredSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!isOnboarded) return <Navigate to="/onboarding" replace />;
  return children;
}

/** For /login, /signup — bounce already-authenticated users onward instead of showing the form again. */
export function RedirectIfAuthed({ children }) {
  const { user, loading, isOnboarded } = useAuth();
  if (loading) return <CenteredSpinner />;
  if (user) return <Navigate to={isOnboarded ? "/dashboard" : "/onboarding"} replace />;
  return children;
}
