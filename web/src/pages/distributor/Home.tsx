import { Link } from "react-router-dom";
import { ChevronRight, Coins, Receipt, ScanLine, Users, DollarSign } from "lucide-react";
import { useSession } from "@/auth/AuthProvider";
import { useQuery } from "@/lib/hooks";
import type { Transaction } from "@/lib/types";
import { formatPoints, formatUsd, lastMonths } from "@/lib/format";
import { Card, Empty, PageLoader, SectionTitle, Stat } from "@/components/ui";
import { TxList } from "@/components/TxList";
import { MonthlyBars, SERIES } from "@/components/Charts";
import { txByDistributor, useDistributorMonthly, useMyDistributor } from "./data";

export default function DistributorHome() {
  const { distributorId } = useSession();
  const d = useMyDistributor();
  const tx = useQuery<Transaction>(() => (distributorId ? txByDistributor(distributorId, 6) : null), [distributorId]);
  const monthly = useDistributorMonthly(distributorId, 6);
  if (d.loading) return <PageLoader />;
  const dist = d.data;
  const byMonth = Object.fromEntries(monthly.data.map((m) => [m.month, m]));
  const chart = lastMonths(6).map((m) => ({ month: m, pointsGenerated: byMonth[m]?.pointsGenerated ?? 0 }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-muted">Distribuidor</p>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{dist?.name}</h1>
      </div>

      <Link to="/distribuidor/compra" className="group block animate-rise">
        <div className="wallet-card relative flex items-center gap-5 overflow-hidden rounded-[28px] p-6 text-white shadow-[var(--shadow-float)] transition group-active:scale-[0.99] sm:p-8">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-[#3ddc97] text-brand-900 shadow-lg sm:size-20"><ScanLine className="size-8 sm:size-10" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-extrabold tracking-tight sm:text-3xl">Registrar compra</p>
            <p className="mt-1 text-sm text-white/70">Escanea el QR del socio, ingresa el monto y acredita sus puntos.</p>
          </div>
          <ChevronRight className="size-7 shrink-0 text-white/60 transition group-hover:translate-x-1" />
        </div>
      </Link>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Puntos generados" value={formatPoints(dist?.pointsGenerated ?? 0)} icon={<Coins className="size-4" />} />
        <Stat label="Compras registradas" value={formatPoints(dist?.purchaseCount ?? 0)} icon={<Receipt className="size-4" />} />
        <Stat label="Afiliados vinculados" value={formatPoints(dist?.affiliateCount ?? 0)} icon={<Users className="size-4" />} />
        <Stat label="Ventas registradas" value={formatUsd(dist?.salesCents ?? 0)} icon={<DollarSign className="size-4" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-4 sm:p-5">
          <SectionTitle action={<Link to="/distribuidor/historial" className="flex items-center text-sm font-semibold text-brand-700">Historial <ChevronRight className="size-4" /></Link>}>Últimas operaciones</SectionTitle>
          {tx.loading ? <PageLoader /> : tx.data.length ? <TxList items={tx.data} perspective="distributor" /> : <Empty icon={<Receipt className="size-5" />} title="Aún no registras compras" />}
        </Card>
        <Card className="p-4 sm:p-5">
          <SectionTitle>Puntos generados por mes</SectionTitle>
          <MonthlyBars data={chart} series={[{ key: "pointsGenerated", label: "Puntos generados", color: SERIES.s1 }]} />
        </Card>
      </div>
    </div>
  );
}
