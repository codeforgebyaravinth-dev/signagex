import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Toaster } from "./components/ui/sonner";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminDealers from "./pages/admin/AdminDealers";
import AdminTemplates from "./pages/admin/AdminTemplates";
import AdminClients from "./pages/admin/AdminClients";
import AdminPlans from "./pages/admin/AdminPlans";
import AdminDevices from "./pages/admin/AdminDevices";
import AdminPayments from "./pages/admin/AdminPayments";
import DealerDashboard from "./pages/dealer/DealerDashboard";
import DealerClients from "./pages/dealer/DealerClients";
import DealerPlans from "./pages/dealer/DealerPlans";
import DealerTemplates from "./pages/dealer/DealerTemplates";
import DealerScreens from "./pages/dealer/DealerScreens";
import DealerPayments from "./pages/dealer/DealerPayments";
import ClientDashboard from "./pages/client/ClientDashboard";
import ClientDevices from "./pages/client/ClientDevices";
import ClientTemplates from "./pages/client/ClientTemplates";
import ClientStorefront from "./pages/client/ClientStorefront";
import ClientMedia from "./pages/client/ClientMedia";
import ClientPlaylists from "./pages/client/ClientPlaylists";
import ClientSchedules from "./pages/client/ClientSchedules";
import ClientPayments from "./pages/client/ClientPayments";
import PublicBooking from "./pages/PublicBooking";
// Use the new SignagePlayer implementation in its own folder (includes pairing UI)
import SignagePlayer from "./pages/SignagePlayer/SignagePlayer";

function isNativePlayerShell() {
 if (typeof window === "undefined") return false;
  try {
    if (window.Capacitor && typeof window.Capacitor.getPlatform === "function") {
      return window.Capacitor.getPlatform() !== "web";
    }
  } catch {
    return false;
  }
  return false;
}

function ProtectedRoute({ role, children }) {
  const { user, loading } = useAuth();
  if (loading || user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-sm text-[#6B7280] font-mono uppercase tracking-widest animate-pulse">Loading...</div>
      </div>
    );
  }
  if (user === false) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    const home = user.role === "admin" ? "/admin" : user.role === "dealer" ? "/dealer" : "/client";
    return <Navigate to={home} replace />;
  }
  return children;
}

function Root() {
  const { user, loading } = useAuth();
  if (isNativePlayerShell()) {
    return <Navigate to="/play" replace />;
    
  }
  if (loading || user === null) return null;
  if (user === false) return <Navigate to="/login" replace />;
  const home = user.role === "admin" ? "/admin" : user.role === "dealer" ? "/dealer" : "/client";
  return <Navigate to={home} replace />;
}

export default function App() {
  if (isNativePlayerShell()) {
    return (
      <AuthProvider>
        <BrowserRouter>
          <SignagePlayer />
        </BrowserRouter>
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/login" element={<Login />} />
          <Route path="/book/:clientId" element={<PublicBooking />} />
          <Route path="/play/:pairCode" element={<SignagePlayer />} />
          <Route path="/play" element={<SignagePlayer />} />

          <Route element={<ProtectedRoute role="admin"><Layout /></ProtectedRoute>}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/dealers" element={<AdminDealers />} />
            <Route path="/admin/templates" element={<AdminTemplates />} />
            <Route path="/admin/plans" element={<AdminPlans />} />
            <Route path="/admin/devices" element={<AdminDevices />} />
            <Route path="/admin/payments" element={<AdminPayments />} />
            <Route path="/admin/clients" element={<AdminClients />} />
          </Route>

          <Route element={<ProtectedRoute role="dealer"><Layout /></ProtectedRoute>}>
            <Route path="/dealer" element={<DealerDashboard />} />
            <Route path="/dealer/clients" element={<DealerClients />} />
            <Route path="/dealer/plans" element={<DealerPlans />} />
            <Route path="/dealer/screens" element={<DealerScreens />} />
            <Route path="/dealer/templates" element={<DealerTemplates />} />
            <Route path="/dealer/payments" element={<DealerPayments />} />
          </Route>

          <Route element={<ProtectedRoute role="client"><Layout /></ProtectedRoute>}>
            <Route path="/client" element={<ClientDashboard />} />
            <Route path="/client/devices" element={<ClientDevices />} />
            <Route path="/client/media" element={<ClientMedia />} />
            <Route path="/client/playlists" element={<ClientPlaylists />} />
            <Route path="/client/schedules" element={<ClientSchedules />} />
            <Route path="/client/templates" element={<ClientTemplates />} />
            <Route path="/client/payments" element={<ClientPayments />} />
            <Route path="/client/storefront" element={<ClientStorefront />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}
