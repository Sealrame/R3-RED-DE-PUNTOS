import { useState } from "react";
import { collection, limit, orderBy, query, where, type QueryConstraint } from "firebase/firestore";
import { Download, Receipt } from "lucide-react";
import { db } from "@/lib/firebase";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/auth/AuthProvider";
import type { Transaction, WithId } from "@/lib/types";
import { ecDayEnd, ecDayStart, fmtDateTime, formatPoints, formatUsd } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { Button, Card, Empty, PageHeader, PageLoader, Sheet, StatusBadge } from "@/components/ui";
import { TxList } from "@/components/TxList";
import { EMPTY_FILTERS, TxFilters } from "@/components/TxFilters";
import { TX_TYPE_LABEL } from "@shared/domain";

export default function DistributorHistory() {
  const { distributorId } = useSession();
  const [f, setF] = useState(EMPTY_FILTERS);
  const [n, setN] = useState(50);
  const [sel, setSel] = useState<WithId<Transaction> | null>(null);
  const tx = useQuery<Transaction>(() => {
    if (!distributorId) return null;
    const c: QueryConstraint[] = [where("distributorId", "==", distributorId)];
    if (f.type) c.push(where("type", "==", f.type));
    if (f.status) c.push(where("status", "==", f.status));
    if (f.from) c.push(where("createdAt", ">=", ecDayStart(f.from)));
    if (f.to) c.push(where("createdAt", "<=", ecDayEnd(f.to)));
    return query(collection(db, "transactions"), ...c, orderBy("createdAt", "desc"), limit(n));
  }, [distributorId, f.type, f.status, f.from, f.to, n]);

  const totals = tx.data.reduce((a, t) => ({ pts: a.pts + t.points, usd: a.usd + (t.type === "purchase" ? t.amountCents : 0) }), { pts: 0, usd: 0 });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Historial de compras" subtitle="Solo se muestran las operaciones registradas por tu cuenta."
        actions={<Button variant="secondary" size="sm" disabled={!tx.data.length} onClick={() => downloadCsv(`historial-${new Date().toISOString().slice(0, 10)}.csv`,
          ["ID", "Fecha", "Tipo", "Estado", "Socio", "Código", "Monto USD", "Puntos", "Referencia"],
          tx.data.map((t) => [t.id, fmtDateTime(t.createdAt), TX_TYPE_LABEL[t.type], t.status, t.affiliateName, t.affiliateCode, (t.amountCents / 100).toFixed(2), t.points, t.reference ?? ""]))}>
          <Download className="size-4" /> Exportar CSV</Button>} />
      <Card className="mb-4 p-4"><TxFilters value={f} onChange={(v) => { setF(v); setN(50); }} /></Card>
      <div className="mb-3 flex gap-4 px-1 text-sm text-muted">
        <span>{tx.data.length} operaciones</span><span>Ventas: <b className="text-ink">{formatUsd(totals.usd)}</b></span><span>Puntos: <b className="text-ink">{formatPoints(totals.pts)}</b></span>
      </div>
      <Card className="p-3 sm:p-4">
        {tx.loading && !tx.data.length ? <PageLoader /> : tx.error ? <Empty title="No se pudo cargar">{tx.error.message}</Empty> : tx.data.length ? <TxList items={tx.data} perspective="distributor" onSelect={setSel} /> : <Empty icon={<Receipt className="size-5" />} title="Sin operaciones con estos filtros" />}
        {tx.data.length >= n && <Button variant="ghost" block onClick={() => setN(n + 50)}>Cargar más</Button>}
      </Card>
      <Sheet open={!!sel} onClose={() => setSel(null)} title="Estado de la transacción">
        {sel && (
          <dl className="divide-y divide-line text-sm">
            {[["ID", sel.id], ["Estado", <StatusBadge key="s" status={sel.status} />], ["Tipo", TX_TYPE_LABEL[sel.type]], ["Fecha", fmtDateTime(sel.createdAt)], ["Socio", `${sel.affiliateName} (${sel.affiliateCode})`],
              ["Monto", formatUsd(Math.abs(sel.amountCents))], ["Puntos", formatPoints(sel.points)], ...(sel.reference ? [["Referencia", sel.reference]] : []),
              ...(sel.reversalReason ? [["Motivo del reverso", sel.reversalReason]] : [])].map(([k, v], i) => (
              <div key={i} className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="break-all text-right font-semibold">{v}</dd></div>
            ))}
          </dl>
        )}
        <p className="mt-4 text-xs text-muted">Las operaciones confirmadas no pueden eliminarse. Si hubo un error, solicita al administrador un reverso.</p>
      </Sheet>
    </div>
  );
}
