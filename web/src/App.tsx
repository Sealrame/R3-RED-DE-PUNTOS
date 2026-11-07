import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, HOME, useSession } from "@/auth/AuthProvider";
import { RequireRole } from "@/layouts/AppShell";
import { Empty, PageLoader, ToastProvider } from "@/components/ui";
import Login from "@/pages/public/Login";
import Register from "@/pages/public/Register";

const AffiliateHome = lazy(() => import("@/pages/affiliate/Home"));
const MyQr = lazy(() => import("@/pages/affiliate/MyQr"));
const AffiliateRewards = lazy(() => import("@/pages/affiliate/Rewards"));
const Movements = lazy(() => import("@/pages/affiliate/Movements"));
const Profile = lazy(() => import("@/pages/affiliate/Profile"));

const DistributorHome = lazy(() => import("@/pages/distributor/Home"));
const RegisterPurchase = lazy(() => import("@/pages/distributor/RegisterPurchase"));
const DistributorHistory = lazy(() => import("@/pages/distributor/History"));
const DistributorAffiliates = lazy(() => import("@/pages/distributor/Affiliates"));
const RegistrationQr = lazy(() => import("@/pages/distributor/RegistrationQr"));

const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const AdminDistributors = lazy(() => import("@/pages/admin/Distributors"));
const DistributorDetail = lazy(() => import("@/pages/admin/DistributorDetail"));
const AdminAffiliates = lazy(() => import("@/pages/admin/Affiliates"));
const AffiliateDetail = lazy(() => import("@/pages/admin/AffiliateDetail"));
const AdminTransactions = lazy(() => import("@/pages/admin/Transactions"));
const AdminRedemptions = lazy(() => import("@/pages/admin/Redemptions"));
const AdminRewards = lazy(() => import("@/pages/admin/Rewards"));
const Control = lazy(() => import("@/pages/admin/Control"));
const Settings = lazy(() => import("@/pages/admin/Settings"));

function Root() {
  const s = useSession();
  if (s.loading) return <PageLoader />;
  return <Navigate to={s.user && s.role ? HOME[s.role] : "/ingresar"} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Root />} />
              <Route path="/ingresar" element={<Login />} />
              <Route path="/registro" element={<Register />} />

              <Route path="/socio" element={<RequireRole role="affiliate" />}>
                <Route index element={<AffiliateHome />} />
                <Route path="qr" element={<MyQr />} />
                <Route path="recompensas" element={<AffiliateRewards />} />
                <Route path="movimientos" element={<Movements />} />
                <Route path="perfil" element={<Profile />} />
              </Route>

              <Route path="/distribuidor" element={<RequireRole role="distributor" />}>
                <Route index element={<DistributorHome />} />
                <Route path="compra" element={<RegisterPurchase />} />
                <Route path="historial" element={<DistributorHistory />} />
                <Route path="afiliados" element={<DistributorAffiliates />} />
                <Route path="registro-qr" element={<RegistrationQr />} />
              </Route>

              <Route path="/admin" element={<RequireRole role="admin" />}>
                <Route index element={<AdminDashboard />} />
                <Route path="distribuidores" element={<AdminDistributors />} />
                <Route path="distribuidores/:id" element={<DistributorDetail />} />
                <Route path="afiliados" element={<AdminAffiliates />} />
                <Route path="afiliados/:id" element={<AffiliateDetail />} />
                <Route path="transacciones" element={<AdminTransactions />} />
                <Route path="canjes" element={<AdminRedemptions />} />
                <Route path="recompensas" element={<AdminRewards />} />
                <Route path="control" element={<Control />} />
                <Route path="configuracion" element={<Settings />} />
              </Route>

              <Route path="*" element={<div className="p-10"><Empty title="Página no encontrada" /></div>} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
