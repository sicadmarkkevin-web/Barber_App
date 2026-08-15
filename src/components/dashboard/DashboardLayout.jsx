import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { signOut } from "../../api/auth";
import Sidebar from "./Sidebar";
import MobileDashboardNav from "./MobileDashboardNav";

export default function DashboardLayout() {
  const { barber } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="dash-shell">
      <Sidebar barber={barber} onSignOut={handleSignOut} />
      <MobileDashboardNav barber={barber} onSignOut={handleSignOut} />
      <div className="dash-main">
        <Outlet />
      </div>
    </div>
  );
}
