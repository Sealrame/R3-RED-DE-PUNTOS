import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, limit, orderBy, query, where } from "firebase/firestore";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { db } from "@/lib/firebase";
import { useDoc, useQuery } from "@/lib/hooks";
import { api, errorMessage, newKey } from "@/lib/api";
import type { Affiliate, Redemption, Transaction, Wallet } from "@/lib/types";
import { fmtDate, fmtDateTime, formatPoints } from "@/lib/format";
import { Alert, Button, Card, Empty, Field, Input, PageLoader, SectionTitle, Segmented, Sheet, Stat, StatusBadge, Textarea, useToast } from "@/components/ui";
import { TxList } from "@/components/TxList";
import { QrImage } from "@/components/Qr";
import { AccountActions } from "@/components/AccountActions";
import { encodeAffiliateQr } from "@shared/domain";

export default function AffiliateDetail() {
  const { id = "" } = useParams();
  const a = useDoc<Affiliate>(() => doc(db, "affiliates", id), [id]);
  const w = useDoc<Wallet>(() => doc(db, "points_wallets", id), [id]);
  const [n, setN] = useState(20);
  const tx = useQuery<Transaction>(() => query(collection(db, "transactions"), where("affiliateId", "==", id), orderBy("createdAt", "desc"), limit(n)), [id, n]);
  const reds = useQuery<Redemption>(() => query(collection(db, "redemptions"), where("affiliateId", "==", id), orderBy("requestedAt", "desc"), limit(20)), [id]);
  const [adjust, setAdjust] = useState(false);
  if (a.loading) return <PageLoader />;
  if (!a.data) return <Empty title="Afiliado no encontrado" />;
  const x = a.data, wallet = w.data;
  return (
    <div className="space-y-6">
      <Link to="/admin/afiliados" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-2"><ArrowLeft className="size-4" /> Afiliados</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-extrabold tracking-tight">{x.fullName}</h1><StatusBadge status={x.status} /></div>
          <p className="tabular mt-1 text-sm text-muted">{x.code} · {x.idType.toUpperCase()} {x.idNumber} · Desde {fmtDate(x.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setAdjust(true)}><SlidersHorizontal className="size-4" /> Ajustar puntos</Button>
          <AccountActions targetType="affiliate" id={id} status={x.status} name={x.fullName} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat accent label="Saldo actual" value={formatPoints(wallet?.balance ?? 0)} sub={wallet?.reserved ? `${formatPoints(wallet.reserved)} reservados` : "Sin reservas"} />
        <Stat label="Total ganado" value={formatPoints(wallet?.totalEarned ?? 0)} />
        <Stat label="Total canjeado" value={formatPoints(wallet?.totalRedeemed ?? 0)} />
        <Stat label="Ajustes netos" value={formatPoints(wallet?.totalAdjusted ?? 0)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card className="p-4 sm:p-5">
          <SectionTitle>Movimientos</SectionTitle>
          {tx.data.length ? <TxList items={tx.data} perspective="admin" /> : <Empty title="Sin movimientos" />}
          {tx.data.length >= n && <Button variant="ghost" block onClick={() => setN(n + 20)}>Cargar más</Button>}
        </Card>
        <div className="space-y-6">
          <Card className="p-4 sm:p-5">
            <SectionTitle>Contacto y QR</SectionTitle>
            <dl className="space-y-1.5 text-sm">
              {[["Teléfono", x.phone], ["Correo", x.email], ["Distribuidor", x.distributorName]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="truncate font-semibold">{v || "—"}</dd></div>
              ))}
            </dl>
            <div className="mt-4 grid place-items-center rounded-2xl bg-paper p-4"><QrImage value={encodeAffiliateQr(x.qrToken)} size={140} /></div>
          </Card>
          <Card className="p-4 sm:p-5">
            <SectionTitle>Canjes</SectionTitle>
            {reds.data.length ? (
              <ul className="divide-y divide-line">
                {reds.data.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0"><p className="truncate font-semibold">{r.rewardName}</p><p className="text-xs text-muted">{fmtDateTime(r.requestedAt)} · {formatPoints(r.pointsCost)} pts{r.code ? ` · ${r.code}` : ""}</p></div>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            ) : <Empty title="Sin canjes" />}
          </Card>
        </div>
      </div>
      <AdjustSheet open={adjust} onClose={() => setAdjust(false)} affiliateId={id} name={x.fullName} available={(wallet?.balance ?? 0) - (wallet?.reserved ?? 0)} />
    </div>
  );
}

function AdjustSheet({ open, onClose, affiliateId, name, available }: { open: boolean; onClose: () => void; affiliateId: string; name: string; available: number }) {
  const toast = useToast();
  const [dir, setDir] = useState<"add" | "sub">("add");
  const [pts, setPts] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = useMemo(() => newKey(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = Number(pts);
  const valid = Number.isInteger(n) && n > 0 && reason.trim().length >= 10;
  return (
    <Sheet open={open} onClose={onClose} title={`Ajustar puntos · ${name}`}>
      <div className="space-y-4">
        <Segmented value={dir} onChange={setDir} options={[{ value: "add", label: "Sumar" }, { value: "sub", label: "Restar" }]} />
        <Field label="Puntos" hint={`Disponible actualmente: ${formatPoints(available)} pts`}><Input inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Justificación obligatoria" hint="Mínimo 10 caracteres. Queda registrada en auditoría."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {err && <Alert tone="bad">{err}</Alert>}
        <Button block loading={busy} disabled={!valid} onClick={async () => {
          setBusy(true); setErr(null);
          try { await api.adjustPoints({ affiliateId, delta: dir === "add" ? n : -n, reason: reason.trim(), idempotencyKey: key }); toast("Ajuste registrado"); setPts(""); setReason(""); onClose(); }
          catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
        }}>Registrar ajuste de {dir === "add" ? "+" : "−"}{n || 0} pts</Button>
      </div>
    </Sheet>
  );
}
