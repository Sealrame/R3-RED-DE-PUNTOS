import { useState } from "react";
import { Link } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { AlertTriangle, ScrollText, ShieldCheck } from "lucide-react";
import { db } from "@/lib/firebase";
import { useQuery } from "@/lib/hooks";
import { api, errorMessage } from "@/lib/api";
import type { AuditLog, Transaction, WithId } from "@/lib/types";
import { fmtDateTime, formatPoints } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { Alert, Badge, Button, Card, Empty, PageHeader, PageLoader, SectionTitle, Select } from "@/components/ui";
import { TxList } from "@/components/TxList";
import { TxDetail } from "./Transactions";

const ACTIONS: Record<string, string> = {
  "purchase.register": "Compra registrada", "purchase.reverse": "Compra revertida", "points.adjust": "Ajuste de puntos",
  "redemption.request": "Canje solicitado", "redemption.approve": "Canje aprobado", "redemption.reject": "Canje rechazado", "redemption.cancel": "Canje cancelado", "redemption.deliver": "Canje entregado",
  "distributor.create": "Distribuidor creado", "distributor.update": "Distribuidor editado", "distributor.status": "Estado de distribuidor", "distributor.resetPassword": "Contraseña de distribuidor",
  "affiliate.register": "Afiliado registrado", "affiliate.updateProfile": "Perfil de afiliado", "affiliate.status": "Estado de afiliado", "affiliate.resetPassword": "Contraseña de afiliado",
  "reward.create": "Recompensa creada", "reward.update": "Recompensa editada", "config.points.update": "Reglas de puntos", "integrity.check": "Verificación de consistencia", "admin.bootstrap": "Alta de administrador",
};

export default function Control() {
  const flagged = useQuery<Transaction>(() => query(collection(db, "transactions"), where("flags", "array-contains", "possible_duplicate"), orderBy("createdAt", "desc"), limit(30)), []);
  const [sel, setSel] = useState<WithId<Transaction> | null>(null);
  const [action, setAction] = useState("");
  const [n, setN] = useState(50);
  const logs = useQuery<AuditLog>(() => query(collection(db, "audit_logs"), ...(action ? [where("action", "==", action)] : []), orderBy("createdAt", "desc"), limit(n)), [action, n]);
  const [check, setCheck] = useState<{ scanned: number; issues: { affiliateId: string; balance: number; expectedBalance: number; reserved: number; expectedReserved: number }[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const runCheck = async () => {
    setChecking(true); setErr(null);
    try {
      let after: string | null = null; let scanned = 0; const issues: NonNullable<typeof check>["issues"] = [];
      do { const r = await api.runIntegrityCheck({ after }); scanned += r.scanned; issues.push(...r.issues); after = r.next; } while (after);
      setCheck({ scanned, issues });
    } catch (e) { setErr(errorMessage(e)); } finally { setChecking(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Control y auditoría" subtitle="Detección de duplicados, verificación de saldos e historial de cambios." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <SectionTitle><span className="inline-flex items-center gap-2"><AlertTriangle className="size-4 text-warn" /> Posibles compras duplicadas</span></SectionTitle>
          <p className="mb-3 text-xs text-muted">Compras del mismo monto, socio y distribuidor dentro de la ventana configurada que el distribuidor confirmó manualmente. Revísalas y revierte si corresponde.</p>
          {flagged.loading ? <PageLoader /> : flagged.data.length ? <TxList items={flagged.data} perspective="admin" onSelect={setSel} /> : <Empty title="Sin alertas" />}
        </Card>
        <Card className="p-4 sm:p-5">
          <SectionTitle><span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-brand-600" /> Verificación de consistencia</span></SectionTitle>
          <p className="text-sm text-ink-2">Recalcula el saldo de cada billetera a partir de sus movimientos y valida las reservas de canjes pendientes.</p>
          <Button className="mt-4" loading={checking} onClick={runCheck}>Ejecutar verificación</Button>
          {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
          {check && (
            <div className="mt-4">
              {check.issues.length === 0 ? <Alert tone="ok">Todo cuadra: {check.scanned} billeteras verificadas sin diferencias.</Alert> : (
                <>
                  <Alert tone="bad">{check.issues.length} billeteras con diferencias de {check.scanned} verificadas.</Alert>
                  <ul className="mt-3 divide-y divide-line text-sm">
                    {check.issues.map((i) => (
                      <li key={i.affiliateId} className="flex justify-between gap-3 py-2">
                        <Link className="font-semibold text-brand-700" to={`/admin/afiliados/${i.affiliateId}`}>{i.affiliateId}</Link>
                        <span className="tabular text-right text-xs">Saldo {formatPoints(i.balance)} vs {formatPoints(i.expectedBalance)}<br />Reservado {i.reserved} vs {i.expectedReserved}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </Card>
      </div>
      <Card className="p-4 sm:p-5">
        <SectionTitle action={
          <div className="flex gap-2">
            <Select value={action} onChange={(e) => { setAction(e.target.value); setN(50); }} className="h-9 w-auto! max-w-56 text-sm" aria-label="Filtrar acción">
              <option value="">Todas las acciones</option>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Button size="sm" variant="secondary" disabled={!logs.data.length} onClick={() => downloadCsv("auditoria.csv", ["Fecha", "Acción", "Rol", "Usuario", "Objeto", "ID", "Datos"],
              logs.data.map((l) => [fmtDateTime(l.createdAt), l.action, l.actorRole, l.actorUid, l.targetType, l.targetId, JSON.stringify(l.data)]))}>CSV</Button>
          </div>}>
          <span className="inline-flex items-center gap-2"><ScrollText className="size-4" /> Registro de auditoría</span>
        </SectionTitle>
        {logs.loading && !logs.data.length ? <PageLoader /> : !logs.data.length ? <Empty title="Sin registros" /> : (
          <ul className="divide-y divide-line">
            {logs.data.map((l) => (
              <li key={l.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{ACTIONS[l.action] ?? l.action}</span>
                  <Badge>{l.actorRole}</Badge>
                  <span className="ml-auto text-xs text-muted">{fmtDateTime(l.createdAt)}</span>
                </div>
                <p className="mt-0.5 break-all text-xs text-muted">{l.targetType}/{l.targetId} · por {l.actorUid}</p>
                {Object.keys(l.data ?? {}).length > 0 && (
                  <details className="mt-1"><summary className="cursor-pointer text-xs font-semibold text-ink-2">Ver detalle</summary>
                    <pre className="mt-1 overflow-x-auto rounded-xl bg-paper p-3 text-[11px] leading-relaxed">{JSON.stringify(l.data, null, 2)}</pre></details>
                )}
              </li>
            ))}
          </ul>
        )}
        {logs.data.length >= n && <Button variant="ghost" block onClick={() => setN(n + 50)}>Cargar más</Button>}
      </Card>
      <TxDetail tx={sel} onClose={() => setSel(null)} />
    </div>
  );
}
