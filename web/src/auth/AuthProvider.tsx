import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onIdTokenChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { affiliateLoginEmail, type Role } from "@shared/domain";
import type { UserProfile } from "@/lib/types";

interface Session {
  user: User | null;
  role: Role | null;
  distributorId?: string;
  affiliateId?: string;
  profile: UserProfile | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<Role | null>;
  logout: () => Promise<void>;
  refreshClaims: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

/** Convierte "correo o número de identificación" en el correo de inicio de sesión. */
export function toLoginEmail(identifier: string) {
  const v = identifier.trim();
  return v.includes("@") ? v.toLowerCase() : affiliateLoginEmail(v.replace(/\s/g, ""));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<{ role?: Role; distributorId?: string; affiliateId?: string }>({});
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      onIdTokenChanged(auth, async (u) => {
        setUser(u);
        if (!u) { setClaims({}); setProfile(null); setLoading(false); return; }
        let r = await u.getIdTokenResult();
        if (!r.claims.role) r = await u.getIdTokenResult(true); // recién registrado: claims recién asignados
        setClaims({ role: r.claims.role as Role, distributorId: r.claims.distributorId as string, affiliateId: r.claims.affiliateId as string });
        setLoading(false);
      }),
    [],
  );

  useEffect(() => {
    if (!user || !claims.role) return;
    return onSnapshot(doc(db, "users", user.uid), (s) => setProfile(s.exists() ? (s.data() as UserProfile) : null), () => setProfile(null));
  }, [user, claims.role]);

  const value = useMemo<Session>(
    () => ({
      user, profile, loading, role: claims.role ?? null, distributorId: claims.distributorId, affiliateId: claims.affiliateId,
      login: async (identifier, password) => {
        const cred = await signInWithEmailAndPassword(auth, toLoginEmail(identifier), password);
        const r = await cred.user.getIdTokenResult(true);
        return (r.claims.role as Role) ?? null;
      },
      logout: () => signOut(auth),
      refreshClaims: async () => {
        if (!auth.currentUser) return;
        const r = await auth.currentUser.getIdTokenResult(true);
        setClaims({ role: r.claims.role as Role, distributorId: r.claims.distributorId as string, affiliateId: r.claims.affiliateId as string });
      },
    }),
    [user, profile, loading, claims],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession fuera de AuthProvider");
  return s;
}

export const HOME: Record<Role, string> = { admin: "/admin", distributor: "/distribuidor", affiliate: "/socio" };
