import { useState } from "react";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { Check, Gift, PackageCheck, Ticket, X } from "lucide-react";
import { db } from "@/lib/firebase";
import { useQuery } from "@/lib/hooks";
import { api, errorMessage } from "@/lib/api";
import type { Redemption, WithId } from "@/lib/types";
import { fmtDateTime, formatPoints } from "@/lib/format";
import type { RedemptionStatus } from "@shared/domain";
import { Alert, Button, Card, Empty, Field, PageHeader, PageLoader, Segmented, Sheet, StatusBadge, Textarea, useToast } from "@/components/ui";

export default function AdminRedemptions() {
  const [status, setStatus] = useState<RedemptionStatus>("pending");
  const list = useQuery<Redemption>(() => query(collection(db, "redemptions"), where("status", "==", status), orderBy("requestedAt", "desc"), limit(100)), [status]);
  const [sel, setSel] = useState<WithId<Redemption> | null>(null);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Canjes" subtitle="Aprueba, rechaza y marca la entrega de premios. Los puntos se descuentan una sola vez al aprobar."
        actions={<Segmented value={status} onChange={setStatus} options={[{ value: "pending", label: "Pendientes" }, { value: "approved", label: "Aprobados" }, { value: "delivered", label: "Entregados" }, { value: "rejected", label: "Rechazados" }]} />} />
      {list.loading ? <PageLoader /> : !list.data.length ? <Card><Empty icon={<Ticket className="size-5" />} title="No hay canjes en este estado" /></Card> : (
        <div className="space-y-3">
          {list.data.map((r) => (
            <Card key={r.id} className="flex items-center gap-4 p-4">
              <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-paper text-muted">
                {r.rewardImageUrl ? <img src={r.rewardImageUrl} alt="" className="size-full object-cover" /> : <Gift className="size-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><p className="truncate font-bold">{r.rewardName}</p><StatusBadge status={r.status} /></div>
                <p className="truncate text-sm text-ink-2">{r.affiliateName} · {r.affiliateCode}</p>
                <p className="text-xs text-muted">{fmtDateTime(r.requestedAt)} · {formatPoints(r.pointsCost)} pts{r.code ? ` · ${r.code}` : ""}</p>
              </div>
              {(r.status === "pending" || r.status === "approved") && <Button size="sm" onClick={() => setSel(r)}>{r.status === "pending" ? "Revisar" : "Entregar"}</Button>}
            </Card>
          ))}
        </div>
      )}
      <ResolveSheet r={sel} onClose={() => setSel(null)} />
    </div>
  );
}

function ResolveSheet({ r, onClose }: { r: WithId<Redemption> | null; onClose: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!r) return null;
  const run = async (action: "approve" | "reject" | "deliver") => {
    setBusy(action); setErr(null);
    try {
      const res = await api.resolveRedemption({ redemptionId: r.id, action, note: note.trim() || undefined });
      toast(action === "approve" ? `Canje aprobado · código ${res.code}` : action === "reject" ? "Canje rechazado, puntos liberados" : "Entrega registrada");
      setNote(""); onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <Sheet open onClose={() => { setErr(null); onClose(); }} title={r.status === "pending" ? "Revisar canje" : "Registrar entrega"}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-paper p-4 text-sm">
          <p className="font-bold">{r.rewardName}</p>
          <p className="text-ink-2">{r.affiliateName} · {r.affiliateCode}</p>
          <p className="tabular mt-2 text-lg font-extrabold">{formatPoints(r.pointsCost)} pts</p>
          {r.code && <p className="mt-1">Código: <b>{r.code}</b></p>}
        </div>
        <Field label={r.status === "pending" ? "Nota (obligatoria para rechazar)" : "Nota de entrega (opcional)"}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {err && <Alert tone="bad">{err}</Alert>}
        {r.status === "pending" ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="text-bad" loading={busy === "reject"} disabled={!!busy || !note.trim()} onClick={() => run("reject")}><X className="size-4" /> Rechazar</Button>
            <Button loading={busy === "approve"} disabled={!!busy} onClick={() => run("approve")}><Check className="size-4" /> Aprobar</Button>
          </div>
        ) : <Button block loading={busy === "deliver"} onClick={() => run("deliver")}><PackageCheck className="size-4" /> Marcar como entregado</Button>}
      </div>
    </Sheet>
  );
}
