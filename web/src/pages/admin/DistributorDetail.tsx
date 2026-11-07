import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc } from "firebase/firestore";
import { ArrowLeft, Pencil } from "lucide-react";
import { db } from "@/lib/firebase";
import { useDoc, useQuery } from "@/lib/hooks";
import type { Distributor, Transaction } from "@/lib/types";
import { fmtDate, fmtDateTime, formatPoints, formatUsd, lastMonths } from "@/lib/format";
import { Button, Card, Empty, PageLoader, SectionTitle, Stat, StatusBadge } from "@/components/ui";
import { TxList } from "@/components/TxList";
import { MonthlyBars, SERIES } from "@/components/Charts";
import { QrActions, QrImage } from "@/components/Qr";
import { AccountActions } from "@/components/AccountActions";
import { txByDistributor, useDistributorMonthly } from "../distributor/data";
import { registrationUrl } from "../distributor/RegistrationQr";
import { DistributorForm } from "./Distributors";

export default function DistributorDetail() {
  const { id = "" } = useParams();
  const d = useDoc<Distributor>(() => doc(db, "distributors", id), [id]);
  const tx = useQuery<Transaction>(() => txByDistributor(id, 10), [id]);
  const monthly = useDistributorMonthly(id, 12);
  const [edit, setEdit] = useState(false);
  if (d.loading) return <PageLoader />;
  if (!d.data) return <Empty title="Distribuidor no encontrado" />;
  const x = d.data;
  const byMonth = Object.fromEntries(monthly.data.map((m) => [m.month, m]));
  const chart = lastMonths(12).map((m) => ({ month: m, pointsGenerated: byMonth[m]?.pointsGenerated ?? 0 }));
  return (
    <div className="space-y-6">
      <Link to="/admin/distribuidores" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-2"><ArrowLeft className="size-4" /> Distribuidores</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-extrabold tracking-tight">{x.name}</h1><StatusBadge status={x.status} /></div>
          <p className="mt-1 text-sm text-muted">{[x.city, x.province].filter(Boolean).join(", ") || "—"} · Desde {fmtDate(x.createdAt)}</p>
          {x.status === "inactive" && x.statusReason && <p className="mt-1 text-xs text-bad">Motivo: {x.statusReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEdit(true)}><Pencil className="size-4" /> Editar</Button>
          <AccountActions targetType="distributor" id={id} status={x.status} name={x.name} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Afiliados vinculados" value={formatPoints(x.affiliateCount)} />
        <Stat label="Compras" value={formatPoints(x.purchaseCount)} sub={`${x.reversalCount ?? 0} reversos`} />
        <Stat label="Ventas" value={formatUsd(x.salesCents)} />
        <Stat label="Puntos generados" value={formatPoints(x.pointsGenerated)} sub={x.lastPurchaseAt ? `Última: ${fmtDateTime(x.lastPurchaseAt)}` : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-4 sm:p-5">
          <SectionTitle>Puntos generados por mes</SectionTitle>
          <MonthlyBars data={chart} series={[{ key: "pointsGenerated", label: "Puntos generados", color: SERIES.s1 }]} />
        </Card>
        <Card className="p-4 sm:p-5">
          <SectionTitle>Datos y QR de registro</SectionTitle>
          <dl className="space-y-1.5 text-sm">
            {[["RUC", x.ruc], ["Contacto", x.contactName], ["Correo de acceso", x.email], ["Teléfono", x.phone], ["Dirección", x.address], ["Código", x.registrationCode]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="truncate text-right font-semibold">{v || "—"}</dd></div>
            ))}
          </dl>
          <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl bg-paper p-4">
            <QrImage value={registrationUrl(x.registrationCode)} size={150} />
            <QrActions value={registrationUrl(x.registrationCode)} title="Únete y acumula puntos" subtitle={x.name} filename={`qr-registro-${x.registrationCode}.png`} />
          </div>
        </Card>
      </div>
      <Card className="p-4 sm:p-5">
        <SectionTitle action={<Link to={`/admin/transacciones?d=${id}`} className="text-sm font-semibold text-brand-700">Ver todas →</Link>}>Últimas operaciones</SectionTitle>
        {tx.data.length ? <TxList items={tx.data} perspective="distributor" /> : <Empty title="Sin operaciones" />}
      </Card>
      {edit && <DistributorForm open onClose={() => setEdit(false)} existing={{ ...x, id }} />}
    </div>
  );
}
