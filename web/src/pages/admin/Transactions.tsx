import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query, where, type QueryConstraint } from "firebase/firestore";
import { Download, Receipt, RotateCcw } from "lucide-react";
import { db } from "@/lib/firebase";
import { useQuery } from "@/lib/hooks";
import { api, errorMessage } from "@/lib/api";
import type { Transaction, WithId } from "@/lib/types";
import { ecDayEnd, ecDayStart, fmtDateTime, formatPoints, formatUsd } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { Alert, Button, Card, Empty, Field, Input, PageHeader, PageLoader, Select, Sheet, StatusBadge, Textarea, useToast } from "@/components/ui";
import { TxList } from "@/components/TxList";
import { EMPTY_FILTERS, TxFilters } from "@/components/TxFilters";
import { TX_TYPE_LABEL } from "@shared/domain";
import { useAllDistributors } from "./data";

const CSV_HEADERS = ["ID", "Fecha", "Tipo", "Estado", "Distribuidor", "ID distribuidor", "Socio", "Código socio", "ID socio", "Monto USD", "Puntos", "Saldo después", "Referencia", "Motivo", "Alertas", "Registrado por"];
const csvRow = (t: WithId<Transaction>) => [t.id, fmtDateTime(t.createdAt), TX_TYPE_LABEL[t.type], t.status, t.distributorName, t.distributorId, t.affiliateName, t.affiliateCode, t.affiliateId,
  (t.amountCents / 100).toFixed(2), t.points, t.balanceAfter, t.reference ?? "", t.reason ?? t.reversalReason ?? "", (t.flags ?? []).join(","), `${t.createdByRole}:${t.createdBy}`];

export default function AdminTransactions() {
  const [params, setParams] = useSearchParams();
  const dists = useAllDistributors();
  const [f, setF] = useState(EMPTY_FILTERS);
  const distributorId = params.get("d") ?? "";
  const affiliateId = params.get("a") ?? "";
  const [affCode, setAffCode] = useState("");
  const [affErr, setAffErr] = useState<string | null>(null);
  const [n, setN] = useState(50);
  const [sel, setSel] = useState<WithId<Transaction> | null>(null);
  const [exporting, setExporting] = useState(false);

  const constraints = (): QueryConstraint[] => {
    const c: QueryConstraint[] = [];
    if (distributorId) c.push(where("distributorId", "==", distributorId));
    if (affiliateId) c.push(where("affiliateId", "==", affiliateId));
    if (f.type) c.push(where("type", "==", f.type));
    if (f.status) c.push(where("status", "==", f.status));
    if (f.from) c.push(where("createdAt", ">=", ecDayStart(f.from)));
    if (f.to) c.push(where("createdAt", "<=", ecDayEnd(f.to)));
    return c;
  };
  const tx = useQuery<Transaction>(() => query(collection(db, "transactions"), ...constraints(), orderBy("createdAt", "desc"), limit(n)), [distributorId, affiliateId, f.type, f.status, f.from, f.to, n]);
  useEffect(() => setN(50), [distributorId, affiliateId, f]);

  const setParam = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  const findAffiliate = async () => {
    setAffErr(null);
    if (!affCode.trim()) { setParam("a", ""); return; }
    try { const a = await api.lookupAffiliate({ content: affCode.trim() }); setParam("a", a.id); } catch (e) { setAffErr(errorMessage(e)); }
  };
  const exportAll = async () => {
    setExporting(true);
    try {
      const snap = await getDocs(query(collection(db, "transactions"), ...constraints(), orderBy("createdAt", "desc"), limit(10000)));
      downloadCsv(`transacciones-${new Date().toISOString().slice(0, 10)}.csv`, CSV_HEADERS, snap.docs.map((d) => csvRow({ id: d.id, ...(d.data() as Transaction) })));
    } finally { setExporting(false); }
  };
  const sum = tx.data.reduce((a, t) => ({ pts: a.pts + t.points, usd: a.usd + (t.type === "purchase" || t.type === "reversal" ? t.amountCents : 0) }), { pts: 0, usd: 0 });

  return (
    <div>
      <PageHeader title="Transacciones" subtitle="Historial completo de la red: quién registró cada operación, cuándo y por cuánto."
        actions={<Button variant="secondary" size="sm" loading={exporting} onClick={exportAll}><Download className="size-4" /> Exportar CSV / Excel</Button>} />
      <Card className="mb-4 space-y-3 p-4">
        <TxFilters value={f} onChange={setF}>
          <label className="col-span-2 text-xs font-semibold text-muted sm:col-span-1">Distribuidor
            <Select value={distributorId} onChange={(e) => setParam("d", e.target.value)} className="mt-1 h-10 sm:w-52">
              <option value="">Todos</option>{dists.data.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </label>
          <label className="col-span-2 text-xs font-semibold text-muted sm:col-span-1">Afiliado (código)
            <form className="mt-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); findAffiliate(); }}>
              <Input value={affCode} onChange={(e) => setAffCode(e.target.value.toUpperCase())} placeholder="AF-…" className="h-10 sm:w-36" />
              <Button type="submit" size="sm" variant="secondary" className="h-10">Filtrar</Button>
            </form>
          </label>
        </TxFilters>
        {affiliateId && <p className="text-xs text-ink-2">Filtrando por afiliado <b>{affiliateId}</b> · <button className="font-semibold text-brand-700" onClick={() => { setAffCode(""); setParam("a", ""); }}>quitar</button></p>}
        {affErr && <Alert tone="bad">{affErr}</Alert>}
      </Card>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 px-1 text-sm text-muted">
        <span>{tx.data.length}{tx.data.length >= n ? "+" : ""} operaciones cargadas</span>
        <span>Ventas netas: <b className="text-ink">{formatUsd(sum.usd)}</b></span><span>Puntos netos: <b className="text-ink">{formatPoints(sum.pts)}</b></span>
      </div>
      <Card className="p-3 sm:p-4">
        {tx.loading && !tx.data.length ? <PageLoader /> : tx.error ? <Alert tone="bad">No se pudo consultar: {tx.error.message}</Alert> : tx.data.length ? <TxList items={tx.data} perspective="admin" onSelect={setSel} /> : <Empty icon={<Receipt className="size-5" />} title="Sin resultados con estos filtros" />}
        {tx.data.length >= n && <Button variant="ghost" block onClick={() => setN(n + 50)}>Cargar más</Button>}
      </Card>
      <TxDetail tx={sel} onClose={() => setSel(null)} />
    </div>
  );
}

export function TxDetail({ tx, onClose }: { tx: WithId<Transaction> | null; onClose: () => void }) {
  const toast = useToast();
  const [reverse, setReverse] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!tx) return null;
  const close = () => { setReverse(false); setReason(""); setErr(null); onClose(); };
  return (
    <Sheet open onClose={close} title="Detalle de transacción">
      <dl className="divide-y divide-line text-sm">
        {([["ID", tx.id], ["Estado", <StatusBadge key="s" status={tx.status} />], ["Tipo", TX_TYPE_LABEL[tx.type]], ["Fecha y hora", fmtDateTime(tx.createdAt)],
          ["Afiliado", `${tx.affiliateName} · ${tx.affiliateCode}`], ["ID afiliado", tx.affiliateId], ["Distribuidor", tx.distributorName ?? "—"], ["ID distribuidor", tx.distributorId ?? "—"],
          ["Monto", formatUsd(tx.amountCents)], ["Puntos", formatPoints(tx.points)], ["Saldo después", formatPoints(tx.balanceAfter)],
          ...(tx.reference ? [["Referencia", tx.reference]] : []), ...(tx.reason ? [["Motivo", tx.reason]] : []), ...(tx.reversalReason ? [["Motivo del reverso", tx.reversalReason]] : []),
          ...(tx.flags?.length ? [["Alertas", tx.flags.join(", ")]] : []), ["Registrado por", `${tx.createdByRole} · ${tx.createdBy}`]] as [string, React.ReactNode][]).map(([k, v], i) => (
          <div key={i} className="flex justify-between gap-4 py-2"><dt className="shrink-0 text-muted">{k}</dt><dd className="break-all text-right font-semibold">{v}</dd></div>
        ))}
      </dl>
      {tx.type === "purchase" && tx.status === "confirmed" && (
        !reverse ? <Button variant="secondary" block className="mt-4 text-bad" onClick={() => setReverse(true)}><RotateCcw className="size-4" /> Revertir compra</Button> : (
          <div className="mt-4 space-y-3 rounded-2xl bg-bad-bg/50 p-4">
            <p className="text-sm text-ink-2">Se creará un movimiento de reverso por −{formatPoints(tx.points)} pts. La compra original no se elimina.</p>
            <Field label="Justificación (mín. 10 caracteres)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            {err && <Alert tone="bad">{err}</Alert>}
            <Button variant="danger" block loading={busy} disabled={reason.trim().length < 10} onClick={async () => {
              setBusy(true); setErr(null);
              try { await api.reversePurchase({ transactionId: tx.id, reason: reason.trim() }); toast("Compra revertida"); close(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
            }}>Confirmar reverso</Button>
          </div>
        )
      )}
    </Sheet>
  );
}
