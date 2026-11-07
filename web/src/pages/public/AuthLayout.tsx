import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { BRAND } from "@/lib/firebase";

export function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="wallet-card relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Logo light />
        <div className="max-w-md">
          {aside ?? (
            <>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">Programa de fidelización</p>
              <h1 className="mt-4 text-5xl font-extrabold leading-[1.05] tracking-tight">Cada dólar suma.<br />En toda la red.</h1>
              <p className="mt-5 text-lg text-white/70">Acumula 1 punto por cada $1 en cualquier distribuidor participante de {BRAND} y canjéalos por premios.</p>
            </>
          )}
        </div>
        <p className="text-xs text-white/40">© {new Date().getFullYear()} {BRAND} · Ecuador</p>
      </div>
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden"><Logo /></div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-8 animate-rise">{children}</div>
      </div>
    </div>
  );
}
