import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  LayoutDashboard, Users, FileVideo, Building2, LogOut, ShieldCheck, Store,
  Layers, Monitor, Store as StoreIcon, UserCircle, Image as ImageIcon, ListMusic, Calendar,
  Wallet, Menu,
} from "lucide-react";
import { Button } from "./ui/button";

const ADMIN_NAV = [
  { to: "/admin", label: "Dashboard", Icon: LayoutDashboard, end: true },
  { to: "/admin/dealers", label: "Dealers", Icon: Building2 },
  { to: "/admin/plans", label: "Plans", Icon: Layers },
  { to: "/admin/templates", label: "Templates", Icon: FileVideo },
  { to: "/admin/devices", label: "Devices", Icon: Monitor },
  { to: "/admin/payments", label: "Payments", Icon: Wallet },
  { to: "/admin/clients", label: "All Clients", Icon: Users },
];

const DEALER_NAV = [
  { to: "/dealer", label: "Dashboard", Icon: LayoutDashboard, end: true },
  { to: "/dealer/clients", label: "My Clients", Icon: Users },
  { to: "/dealer/plans", label: "Plans", Icon: Layers },
  { to: "/dealer/screens", label: "Screens", Icon: Monitor },
  { to: "/dealer/templates", label: "Templates", Icon: FileVideo },
  { to: "/dealer/payments", label: "Payments", Icon: Wallet },
];

const CLIENT_NAV = [
  { to: "/client", label: "Dashboard", Icon: LayoutDashboard, end: true },
  { to: "/client/devices", label: "Devices", Icon: Monitor },
  { to: "/client/media", label: "Media", Icon: ImageIcon },
  { to: "/client/playlists", label: "Playlists", Icon: ListMusic },
  { to: "/client/schedules", label: "Schedule", Icon: Calendar },
  { to: "/client/templates", label: "Templates", Icon: FileVideo },
  { to: "/client/payments", label: "Payments", Icon: Wallet },
  { to: "/client/storefront", label: "Storefront", Icon: StoreIcon },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const items = user?.role === "admin" ? ADMIN_NAV : user?.role === "dealer" ? DEALER_NAV : CLIENT_NAV;
  const RoleIcon = user?.role === "admin" ? ShieldCheck : user?.role === "dealer" ? Store : UserCircle;

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => { await logout(); nav("/login"); };

  return (
    <div className="min-h-screen bg-white text-[#111827] overflow-x-hidden">
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[84vw] max-w-xs flex-col border-r border-[#E5E7EB] bg-white transition-transform duration-200 lg:w-64 lg:translate-x-0 lg:flex ${mobileNavOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="px-6 py-6 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#111827] flex items-center justify-center rounded-sm">
              <FileVideo className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-display font-extrabold text-base tracking-tight leading-none">SIGNAGE OS</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#6B7280] mt-1">Control Panel</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {items.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-sm text-sm transition-colors ${
                  isActive
                    ? "bg-[#111827] text-white hover:text-white"
                    : "text-[#374151] hover:bg-[#F3F4F6]"
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-[#E5E7EB] px-4 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-[#F3F4F6] flex items-center justify-center rounded-sm">
              <RoleIcon className="w-4 h-4 text-[#111827]" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{user?.name}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#6B7280] truncate">{user?.role}</div>
            </div>
          </div>
          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full rounded-sm border-[#E5E7EB] hover:bg-[#F3F4F6]"
            data-testid="logout-btn"
          >
            <LogOut className="w-3.5 h-3.5 mr-2" /> Logout
          </Button>
        </div>
      </aside>

      <main className="min-w-0 lg:pl-64">
        <div className="sticky top-0 z-30 border-b border-[#E5E7EB] bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-[#E5E7EB] text-[#111827]"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 text-right">
              <div className="font-display text-sm font-extrabold tracking-tight">SIGNAGE OS</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#6B7280]">Control Panel</div>
            </div>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8 min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
