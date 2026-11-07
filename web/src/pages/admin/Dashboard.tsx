import { useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, limit, orderBy, query } from "firebase/firestore";
import { AlertTriangle, Building2, Coins, Gift, Receipt, Ticket, Users, Wallet } from "lucide-react";
import { db } from "@/lib/firebase";
import { useDoc, useQuery } from "@/lib/hooks";
import type { Distributor, GlobalStats, MonthlyStats } from "@/lib/types";
import { formatPoints, formatUsd, lastMonths } from "@/lib/format";
import { Card, PageHeader, PageLoader, SectionTitle, Segmented, Select, Stat } from "@/components/ui";
import { MonthlyBars, RankBars, SERIES } from "@/components/Charts";
import { useDistributorMonthly } from "../distributor/data";
import { useAllDistributors } from "./data";

type RankKey = "pointsGenerated" | "affiliateCount" | "salesCents";

export default function AdminDashboard() {
  const stats = useDoc<GlobalStats>(() => doc(db, "stats", "global"), []);
  const [months, setMonths] = useState<"6" | "12">("6");
  const [distFilter, setDistFilter] = useState("");
  const monthly = useQuery<MonthlyStats>(() => query(collection(db, "stats_monthly"), orderBy("month", "desc"), limit(12)), []);
  const distMonthly = useDistributorMonthly(distFilter || null, 12);
  const dists = useAllDistributors();
  const [rank, setRank] = useState<RankKey>("pointsGenerated");
  const ranking = useQuery<Distributor>(() => query(collection(db, "distributors"), orderBy(rank, "desc"), limit(6)), [rank]);

  if (stats.loading) return <PageLoader />;
  const s: GlobalStats = stats.data ?? {};
  const src = distFilter ? distMonthly.data : monthly.data;
  const byMonth = Object.fromEntries(src.map((m) => [m.month, m]));
  const chart = lastMonths(Number(months)).map((m) => ({ month: m, pointsGenerated: byMonth[m]?.pointsGenerated ?? 0, pointsRedeemed: byMonth[m]?.pointsRedeemed ?? 0, salesCents: byMonth[m]?.salesCents ?? 0, purchases: byMonth[m]?.purchases ?? 0 }));
  const periodSales = chart.reduce((a, c) => a + c.salesCents, 0);
  const periodPurchases = chart.reduce((a, c) => a + c.purchases, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Resumen de la red" subtitle="Indicadores en tiempo real de toda la plataforma." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat accent label="Puntos en circulación" value={formatPoints(s.pointsInCirculation ?? 0)} icon={<Wallet className="size-4" />} sub="Saldo total de los socios" />
        <Stat label="Puntos generados" value={formatPoints(s.pointsGenerated ?? 0)} icon={<Coins className="size-4" />} sub={`Ajustes netos: ${formatPoints(s.pointsAdjusted ?? 0)}`} />
        <Stat label="Puntos canjeados" value={formatPoints(s.pointsRedeemed ?? 0)} icon={<Gift className="size-4" />} sub={`${formatPoints(s.redemptions ?? 0)} canjes aprobados`} />
        <Stat label="Compras registradas" value={formatPoints(s.purchases ?? 0)} icon={<Receipt className="size-4" />} sub={formatUsd(s.salesCents ?? 0)} />
        <Stat label="Distribuidores activos" value={formatPoints(s.distributorsActive ?? 0)} icon={<Building2 className="size-4" />} sub={`${formatPoints(s.distributorsTotal ?? 0)} en total`} />
        <Stat label="Afiliados registrados" value={formatPoints(s.affiliates ?? 0)} icon={<Users className="size-4" />} />
        <Link to="/admin/canjes"><Stat label="Canjes pendientes" value={formatPoints(s.redemptionsPending ?? 0)} icon={<Ticket className="size-4" />} sub="Requieren aprobación" /></Link>
        <Link to="/admin/control"><Stat label="Alertas de duplicado" value={formatPoints(s.flagged ?? 0)} icon={<AlertTriangle className="size-4" />} sub={`${formatPoints(s.reversals ?? 0)} reversos`} /></Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card className="p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-[15px] font-bold tracking-tight">Evolución mensual de puntos</h2>
            <div className="flex flex-wrap gap-2">
              <Select value={distFilter} onChange={(e) => setDistFilter(e.target.value)} className="h-9 w-auto! max-w-56 text-sm" aria-label="Filtrar por distribuidor">
                <option value="">Toda la red</option>
                {dists.data.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
              <Segmented value={months} onChange={setMonths} options={[{ value: "6", label: "6 m" }, { value: "12", label: "12 m" }]} />
            </div>
          </div>
          <MonthlyBars data={chart} series={distFilter ? [{ key: "pointsGenerated", label: "Puntos generados", color: SERIES.s1 }] : [{ key: "pointsGenerated", label: "Generados", color: SERIES.s1 }, { key: "pointsRedeemed", label: "Canjeados", color: SERIES.s2 }]} height={260} />
          <p className="mt-3 text-xs text-muted">En el periodo: {formatPoints(periodPurchases)} compras · {formatUsd(periodSales)} en ventas</p>
        </Card>
        <Card className="p-4 sm:p-5">
          <SectionTitle>Ranking de distribuidores</SectionTitle>
          <div className="mb-4"><Segmented value={rank} onChange={setRank} options={[{ value: "pointsGenerated", label: "Puntos" }, { value: "affiliateCount", label: "Afiliados" }, { value: "salesCents", label: "Ventas" }]} /></div>
          {ranking.loading ? <PageLoader /> : (
            <RankBars items={ranking.data.map((d) => ({ id: d.id, label: d.name, value: d[rank] ?? 0 }))} format={rank === "salesCents" ? formatUsd : formatPoints} />
          )}
          <Link to="/admin/distribuidores" className="mt-4 block text-sm font-semibold text-brand-700">Ver todos →</Link>
        </Card>
      </div>
    </div>
  );
}
