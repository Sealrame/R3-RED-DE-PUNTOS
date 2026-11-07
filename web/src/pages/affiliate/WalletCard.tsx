import type { Affiliate, Wallet } from "@/lib/types";
import { formatPoints } from "@/lib/format";
import { cx } from "@/components/ui";

/** Tarjeta digital tipo wallet con el saldo del socio. */
export function WalletCard({ aff, wallet, className }: { aff: Affiliate | null; wallet: Wallet | null; className?: string }) {
  const available = wallet ? wallet.balance - (wallet.reserved ?? 0) : 0;
  return (
    <div className={cx("wallet-card relative overflow-hidden rounded-[28px] p-6 text-white shadow-[var(--shadow-float)] sm:p-7", className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">Red de Talleres</p>
          <p className="mt-0.5 text-sm font-semibold text-white/80">Socio · Programa de puntos</p>
        </div>
        <img src="/brand/isotipo-night.png" alt="" className="h-8 w-auto" />
      </div>
      <div className="mt-8">
        <p className="text-sm font-medium text-white/60">Puntos disponibles</p>
        <p className="tabular font-display mt-2 text-[64px] leading-none sm:text-[76px]" aria-live="polite">
          {wallet ? formatPoints(available) : "—"}
        </p>
        {wallet && wallet.reserved > 0 && <p className="mt-2 text-xs text-white/60">{formatPoints(wallet.reserved)} pts reservados en canjes pendientes</p>}
      </div>
      <div className="mt-8 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold">{aff?.fullName ?? "…"}</p>
          <p className="tabular text-xs font-semibold tracking-[0.18em] text-white/60">{aff?.code ?? ""}</p>
        </div>

      </div>
    </div>
  );
}
