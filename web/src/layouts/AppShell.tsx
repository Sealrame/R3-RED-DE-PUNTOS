import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { BarChart3, Building2, ClipboardList, Gift, History, Home, LogOut, QrCode, ScanLine, Settings, ShieldCheck, Ticket, User, Users } from "lucide-react";
import { HOME, useSession } from "@/auth/AuthProvider";
import { Logo, PageLoader, cx } from "@/components/ui";
import type { Role } from "@shared/domain";

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; mobile?: boolean };

const NAV: Record<Role, NavItem[]> = {
  admin: [
    { to: "/admin", label: "Resumen", icon: BarChart3, end: true, mobile: true },
    { to: "/admin/distribuidores", label: "Distribuidores", icon: Building2, mobile: true },
    { to: "/admin/afiliados", label: "Afiliados", icon: Users, mobile: true },
    { to: "/admin/transacciones", label: "Transacciones", icon: ClipboardList, mobile: true },
    { to: "/admin/canjes", label: "Canjes", icon: Ticket, mobile: true },
    { to: "/admin/recompensas", label: "Recompensas", icon: Gift },
    { to: "/admin/control", label: "Control y auditoría", icon: ShieldCheck },
    { to: "/admin/configuracion", label: "Configuración", icon: Settings },
  ],
  distributor: [
    { to: "/distribuidor", label: "Inicio", icon: Home, end: true, mobile: true },
    { to: "/distribuidor/compra", label: "Registrar", icon: ScanLine, mobile: true },
    { to: "/distribuidor/historial", label: "Historial", icon: History, mobile: true },
    { to: "/distribuidor/afiliados", label: "Afiliados", icon: Users, mobile: true },
    { to: "/distribuidor/registro-qr", label: "QR de registro", icon: QrCode },
  ],
  affiliate: [
    { to: "/socio", label: "Inicio", icon: Home, end: true, mobile: true },
    { to: "/socio/qr", label: "Mi QR", icon: QrCode, mobile: true },
    { to: "/socio/recompensas", label: "Premios", icon: Gift, mobile: true },
    { to: "/socio/movimientos", label: "Movimientos", icon: History, mobile: true },
    { to: "/socio/perfil", label: "Perfil", icon: User, mobile: true },
  ],
};

const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", distributor: "Distribuidor", affiliate: "Socio" };

export function RequireRole({ role }: { role: Role }) {
  const s = useSession();
  const loc = useLocation();
  if (s.loading) return <PageLoader />;
  if (!s.user) return <Navigate to="/ingresar" replace state={{ from: loc.pathname }} />;
  if (!s.role) return <PageLoader />;
  if (s.role !== role) return <Navigate to={HOME[s.role]} replace />;
  return <AppShell role={role} />;
}

function AppShell({ role }: { role: Role }) {
  const { profile, logout } = useSession();
  const items = NAV[role];
  const mobile = items.filter((i) => i.mobile);
  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Sidebar escritorio */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-white px-4 py-5 backdrop-blur lg:flex">
        <div className="px-2"><Logo /></div>
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end}
              className={({ isActive }) => cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-semibold transition",
                isActive ? "bg-brand-900 text-white shadow-sm" : "text-ink-2 hover:bg-black/5")}>
              <i.icon className="size-[18px]" /> {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="rounded-2xl border border-line bg-paper p-3">
          <p className="truncate text-sm font-bold">{profile?.displayName ?? "…"}</p>
          <p className="text-xs text-muted">{ROLE_LABEL[role]}</p>
          <button onClick={logout} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-ink-2 hover:text-bad"><LogOut className="size-3.5" /> Cerrar sesión</button>
        </div>
      </aside>

      {/* Barra superior móvil */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line/70 bg-white/90 px-4 py-3 backdrop-blur-md lg:hidden" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
        <Logo />
        <div className="flex items-center gap-1">
          {items.filter((i) => !i.mobile).map((i) => (
            <NavLink key={i.to} to={i.to} aria-label={i.label} className={({ isActive }) => cx("grid size-10 place-items-center rounded-full", isActive ? "bg-brand-900 text-white" : "text-ink-2 hover:bg-black/5")}>
              <i.icon className="size-5" />
            </NavLink>
          ))}
          <button onClick={logout} aria-label="Cerrar sesión" className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-black/5"><LogOut className="size-5" /></button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
        <Outlet />
      </main>

      {/* Navegación inferior móvil */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/92 backdrop-blur-md pb-safe lg:hidden">
        <div className="mx-auto flex max-w-lg justify-around px-2 pt-1.5">
          {mobile.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end}
              className={({ isActive }) => cx("flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10.5px] font-bold transition", isActive ? "text-brand-700" : "text-muted")}>
              {({ isActive }) => (
                <>
                  <span className={cx("grid h-7 w-12 place-items-center rounded-full transition", isActive && "bg-brand-100")}><i.icon className="size-[19px]" /></span>
                  <span className="truncate">{i.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
