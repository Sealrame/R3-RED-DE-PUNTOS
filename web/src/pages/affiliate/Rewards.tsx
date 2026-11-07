import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, orderBy, query, where } from "firebase/firestore";
import { Gift, Lock, Ticket } from "lucide-react";
import { db } from "@/lib/firebase";
import { useQuery } from "@/lib/hooks";
import { api, errorMessage, newKey } from "@/lib/api";
import type { Reward, WithId } from "@/lib/types";
import { fmtDateTime, formatPoints } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, PageHeader, PageLoader, Segmented, Sheet, StatusBadge, cx, useToast } from "@/components/ui";
import { useMyAffiliate, useMyRedemptions } from "./data";

export default function AffiliateRewards() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "catalogo" | "canjes") || "catalogo";
  const { wallet } = useMyAffiliate();
  const available = wallet.data ? wallet.data.balance - (wallet.data.reserved ?? 0) : 0;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Recompensas" subtitle={<>Tienes <b className="text-ink">{formatPoints(available)} pts</b> disponibles</>}
        actions={<Segmented value={tab} onChange={(v) => setParams(v === "catalogo" ? {} : { tab: v })} options={[{ value: "catalogo", label: "Catálogo" }, { value: "canjes", label: "Mis canjes" }]} />} />
      {tab === "catalogo" ? <Catalog available={available} onRequested={() => setParams({ tab: "canjes" })} /> : <MyRedemptions />}
    </div>
  );
}

function Catalog({ available, onRequested }: { available: number; onRequested: () => void }) {
  const rewards = useQuery<Reward>(() => query(collection(db, "rewards"), where("active", "==", true), orderBy("pointsCost", "asc")), []);
  const [sel, setSel] = useState<WithId<Reward> | null>(null);
  if (rewards.loading) return <PageLoader />;
  if (!rewards.data.length) return <Card><Empty icon={<Gift className="size-5" />} title="Pronto habrá premios disponibles" /></Card>;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {rewards.data.map((r) => {
          const can = available >= r.pointsCost && r.stock !== 0;
          const pct = Math.min(100, Math.round((available / r.pointsCost) * 100));
          return (
            <button key={r.id} onClick={() => setSel(r)} className="group text-left animate-rise">
              <Card className="overflow-hidden transition group-hover:-translate-y-0.5 group-hover:shadow-lg">
                <div className="relative aspect-[4/3] bg-paper">
                  {r.imageUrl ? <img src={r.imageUrl} alt="" className="size-full object-cover" loading="lazy" /> : <div className="grid size-full place-items-center text-muted"><Gift className="size-8" /></div>}
                  {r.stock === 0 && <span className="absolute left-2 top-2"><Badge tone="bad">Agotado</Badge></span>}
                </div>
                <div className="p-3 sm:p-4">
                  <p className="line-clamp-2 text-sm font-bold leading-snug">{r.name}</p>
                  <p className="tabular mt-1.5 text-[15px] font-extrabold text-brand-700">{formatPoints(r.pointsCost)} pts</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper"><div className={cx("h-full rounded-full", can ? "bg-brand-500" : "bg-gold")} style={{ width: `${pct}%` }} /></div>
                  <p className="mt-1 text-[11px] font-medium text-muted">{can ? "¡Ya puedes canjearlo!" : `Te faltan ${formatPoints(Math.max(0, r.pointsCost - available))} pts`}</p>
                </div>
              </Card>
            </button>
          );
        })}
      </div>
      <RedeemSheet reward={sel} available={available} onClose={() => setSel(null)} onDone={onRequested} />
    </>
  );
}

function RedeemSheet({ reward, available, onClose, onDone }: { reward: WithId<Reward> | null; available: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Una clave por apertura del detalle: si hay doble toque o reintento, el backend no duplica el canje.
  const key = useMemo(() => (reward ? newKey() : ""), [reward]);
  if (!reward) return null;
  const can = available >= reward.pointsCost && reward.stock !== 0;
  return (
    <Sheet open onClose={() => { setErr(null); onClose(); }} title={reward.name}>
      {reward.imageUrl && <img src={reward.imageUrl} alt="" className="mb-4 aspect-video w-full rounded-2xl object-cover" />}
      {reward.description && <p className="text-sm text-ink-2">{reward.description}</p>}
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-paper p-4">
        <span className="text-sm text-muted">Puntos necesarios</span>
        <span className="tabular text-xl font-extrabold">{formatPoints(reward.pointsCost)}</span>
      </div>
      {reward.stock !== null && <p className="mt-2 text-xs text-muted">Disponibles: {reward.stock}</p>}
      {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
      <p className="mt-4 text-xs text-muted">Al solicitar, los puntos quedan reservados hasta que el canje sea aprobado. Si se rechaza o lo cancelas, vuelven a tu saldo.</p>
      <Button className="mt-4" size="lg" block disabled={!can} loading={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try { await api.requestRedemption({ rewardId: reward.id, idempotencyKey: key }); toast("Canje solicitado. Te avisaremos cuando sea aprobado."); onClose(); onDone(); }
        catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
      }}>{can ? "Solicitar canje" : <><Lock className="size-4" /> Puntos insuficientes</>}</Button>
    </Sheet>
  );
}

function MyRedemptions() {
  const reds = useMyRedemptions(50);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (reds.loading) return <PageLoader />;
  if (!reds.data.length) return <Card><Empty icon={<Ticket className="size-5" />} title="Aún no has solicitado canjes" /></Card>;
  return (
    <div className="space-y-3">
      {reds.data.map((r) => (
        <Card key={r.id} className="flex items-center gap-4 p-4">
          <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-paper text-muted">
            {r.rewardImageUrl ? <img src={r.rewardImageUrl} alt="" className="size-full object-cover" /> : <Gift className="size-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><p className="truncate font-bold">{r.rewardName}</p><StatusBadge status={r.status} /></div>
            <p className="text-xs text-muted">{fmtDateTime(r.requestedAt)} · {formatPoints(r.pointsCost)} pts</p>
            {r.code && <p className="mt-1 text-sm">Código de canje: <b className="tabular tracking-wider">{r.code}</b></p>}
            {r.status === "rejected" && r.note && <p className="mt-1 text-xs text-bad">Motivo: {r.note}</p>}
          </div>
          {r.status === "pending" && (
            <Button size="sm" variant="ghost" loading={busy === r.id} onClick={async () => {
              if (!confirm("¿Cancelar esta solicitud? Los puntos volverán a tu saldo.")) return;
              setBusy(r.id);
              try { await api.cancelRedemption({ redemptionId: r.id }); toast("Solicitud cancelada"); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(null); }
            }}>Cancelar</Button>
          )}
        </Card>
      ))}
    </div>
  );
}
