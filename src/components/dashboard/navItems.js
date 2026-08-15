import { LayoutDashboard, CalendarClock, Scissors, Images, User, Clock, SlidersHorizontal, Users } from "lucide-react";

/**
 * Single source of truth for dashboard navigation — used by both the
 * desktop Sidebar and the mobile nav sheet so they can never drift apart.
 * `shopOnly: true` items are only shown for account_type === "shop" (Team
 * management doesn't mean anything for a solo barber).
 */
export const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/dashboard/appointments", label: "Appointments", icon: CalendarClock },
  { to: "/dashboard/staff", label: "Team", icon: Users, shopOnly: true },
  { to: "/dashboard/services", label: "Services", icon: Scissors },
  { to: "/dashboard/styles", label: "Styles", icon: Images },
  { to: "/dashboard/profile", label: "Profile", icon: User },
  { to: "/dashboard/hours", label: "Hours", icon: Clock },
  { to: "/dashboard/booking-settings", label: "Booking Rules", icon: SlidersHorizontal },
];
