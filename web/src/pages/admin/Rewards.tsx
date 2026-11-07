import { useState } from "react";
import { collection, orderBy, query } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { Gift, ImagePlus, Plus } from "lucide-react";
import { db, storage } from "@/lib/firebase";
import { useQuery } from "@/lib/hooks";
import { api, errorMessage, newKey } from "@/lib/api";
import type { Reward, WithId } from "@/lib/types";
import { formatPoints } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, PageLoader, Sheet, Textarea, useToast } from "@/components/ui";

export default function AdminRewards() {
  const rewards = useQuery<Reward>(() => query(collection(db, "rewards"), orderBy("pointsCost", "asc")), []);
  const [edit, setEdit] = useState<WithId<Reward> | "new" | null>(null);
  return (
    <div>
      <PageHeader title="Recompensas" subtitle="Catálogo de premios canjeables por los socios." actions={<Button size="sm" onClick={() => setEdit("new")}><Plus className="size-4" /> Nueva recompensa</Button>} />
      {rewards.loading ? <PageLoader /> : !rewards.data.length ? <Card><Empty icon={<Gift className="size-5" />} title="Aún no hay recompensas">Crea la primera para que los socios puedan canjear sus puntos.</Empty></Card> : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {rewards.data.map((r) => (
            <button key={r.id} className="text-left" onClick={() => setEdit(r)}>
              <Card className={`overflow-hidden transition hover:shadow-lg ${r.active ? "" : "opacity-60"}`}>
                <div className="aspect-[4/3] bg-paper">{r.imageUrl ? <img src={r.imageUrl} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-muted"><Gift className="size-8" /></div>}</div>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-sm font-bold">{r.name}</p>{r.active ? <Badge tone="ok">Activa</Badge> : <Badge>Inactiva</Badge>}</div>
                  <p className="tabular mt-1 font-extrabold text-brand-700">{formatPoints(r.pointsCost)} pts</p>
                  <p className="text-xs text-muted">{r.stock === null ? "Stock ilimitado" : `Stock: ${r.stock}`} · {r.redeemedCount ?? 0} canjeados</p>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
      {edit && <RewardForm reward={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RewardForm({ reward, onClose }: { reward: WithId<Reward> | null; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: reward?.name ?? "", description: reward?.description ?? "", pointsCost: String(reward?.pointsCost ?? ""), stock: reward?.stock === null || reward?.stock === undefined ? "" : String(reward.stock),
    category: reward?.category ?? "", active: reward?.active ?? true, imageUrl: reward?.imageUrl ?? "", imagePath: reward?.imagePath ?? "",
  });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setErr("Usa una imagen PNG, JPG o WEBP."); return; }
    if (file.size > 3 * 1024 * 1024) { setErr("La imagen debe pesar menos de 3 MB."); return; }
    setUploading(true); setErr(null);
    try {
      const path = `rewards/${newKey()}.${file.type.split("/")[1]}`;
      const r = ref(storage, path);
      await uploadBytes(r, file, { contentType: file.type, cacheControl: "public,max-age=31536000" });
      setF((x) => ({ ...x, imageUrl: "", imagePath: path }));
      const url = await getDownloadURL(r);
      setF((x) => ({ ...x, imageUrl: url }));
    } catch (e) { setErr(errorMessage(e)); } finally { setUploading(false); }
  };

  return (
    <Sheet open onClose={onClose} title={reward ? "Editar recompensa" : "Nueva recompensa"} wide>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setErr(null); setBusy(true);
        try {
          await api.saveReward({ id: reward?.id, name: f.name, description: f.description, pointsCost: Number(f.pointsCost), stock: f.stock === "" ? null : Number(f.stock),
            category: f.category, active: f.active, imageUrl: f.imageUrl || undefined, imagePath: f.imagePath || undefined });
          toast(reward ? "Recompensa actualizada" : "Recompensa creada"); onClose();
        } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
      }}>
        <label className="relative grid aspect-[16/7] cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-line-strong bg-paper text-muted hover:border-brand-500">
          {f.imageUrl ? <img src={f.imageUrl} alt="" className="absolute inset-0 size-full object-cover" /> : <span className="flex flex-col items-center gap-1 text-sm font-semibold"><ImagePlus className="size-6" />{uploading ? "Subiendo…" : "Subir imagen (PNG/JPG/WEBP, máx. 3 MB)"}</span>}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre *" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Descripción" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Puntos necesarios *"><Input inputMode="numeric" value={f.pointsCost} onChange={(e) => setF({ ...f, pointsCost: e.target.value.replace(/\D/g, "") })} required /></Field>
          <Field label="Disponibilidad (stock)" hint="Vacío = ilimitado"><Input inputMode="numeric" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Categoría"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Ej. Hogar, Tecnología" /></Field>
          <label className="flex items-center gap-2.5 self-end pb-3 text-sm font-semibold"><input type="checkbox" className="size-4 accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Visible para los socios</label>
        </div>
        {err && <Alert tone="bad">{err}</Alert>}
        <Button type="submit" block size="lg" loading={busy} disabled={uploading}>Guardar</Button>
      </form>
    </Sheet>
  );
}
