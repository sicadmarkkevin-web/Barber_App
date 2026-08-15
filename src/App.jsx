import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { RequireAuth, RequireOnboarded, RedirectIfAuthed } from "./components/shared/RouteGuards";

import Landing from "./routes/Landing";
import Login from "./routes/Login";
import Signup from "./routes/Signup";
import NotFound from "./routes/NotFound";
import OnboardingWizard from "./routes/onboarding/OnboardingWizard";
import DashboardLayout from "./components/dashboard/DashboardLayout";
import DashboardHome from "./routes/dashboard/DashboardHome";
import EditProfile from "./routes/dashboard/EditProfile";
import ServicesManager from "./routes/dashboard/ServicesManager";
import StaffManager from "./routes/dashboard/StaffManager";
import StaffHoursManager from "./routes/dashboard/StaffHoursManager";
import StylesManager from "./routes/dashboard/StylesManager";
import HoursManager from "./routes/dashboard/HoursManager";
import BookingSettingsManager from "./routes/dashboard/BookingSettingsManager";
import AppointmentsManager from "./routes/dashboard/AppointmentsManager";
import BarberPage from "./routes/public/BarberPage";
import BookingFlow from "./routes/public/BookingFlow";
import PaymentReturn from "./routes/public/PaymentReturn";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />

          <Route path="/login" element={<RedirectIfAuthed><Login /></RedirectIfAuthed>} />
          <Route path="/signup" element={<RedirectIfAuthed><Signup /></RedirectIfAuthed>} />

          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <OnboardingWizard />
              </RequireAuth>
            }
          />

          <Route
            element={
              <RequireOnboarded>
                <DashboardLayout />
              </RequireOnboarded>
            }
          >
            <Route path="/dashboard" element={<DashboardHome />} />
            <Route path="/dashboard/profile" element={<EditProfile />} />
            <Route path="/dashboard/services" element={<ServicesManager />} />
            <Route path="/dashboard/staff" element={<StaffManager />} />
            <Route path="/dashboard/staff/:staffId/hours" element={<StaffHoursManager />} />
            <Route path="/dashboard/styles" element={<StylesManager />} />
            <Route path="/dashboard/hours" element={<HoursManager />} />
            <Route path="/dashboard/booking-settings" element={<BookingSettingsManager />} />
            <Route path="/dashboard/appointments" element={<AppointmentsManager />} />
          </Route>
          {/* /customers lands in a later phase as a nested route under /dashboard. */}

          {/* Keep these LAST: /:username is a catch-all that must not shadow the reserved
              routes above. Reserved words are also enforced at signup time (see
              utils/username.js). /:username/book is a distinct two-segment path so it
              never conflicts with /:username regardless of order, but kept nearby for
              readability. */}
          <Route path="/:username/book" element={<BookingFlow />} />
          <Route path="/booking-payment-return" element={<PaymentReturn />} />
          <Route path="/:username" element={<BarberPage />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}