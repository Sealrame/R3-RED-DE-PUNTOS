import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, ChevronRight, Download, Plus, Search } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Distributor, WithId } from "@/lib/types";
import { fmtDate, formatPoints, formatUsd } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { searchKey } from "@shared/domain";
import { Alert, Button, Card, Empty, Field, Input, PageHeader, PageLoader, Sheet, StatusBadge, useToast } from "@/components/ui";
import { useAllDistributors } from "./data";

export default function AdminDistributors() {
  const dists = useAllDistributors();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => dists.data.filter((d) => !q || searchKey(`${d.name} ${d.city ?? ""} ${d.registrationCode} ${d.email}`).includes(searchKey(q))), [dists.data, q]);
  return (
    <div>
      <PageHeader title="Distribuidores" subtitle={`${dists.data.length} distribuidores · ${dists.data.filter((d) => d.status === "active").length} activos`}
        actions={<>
          <Button variant="secondary" size="sm" disabled={!list.length} onClick={() => downloadCsv("distribuidores.csv",
            ["ID", "Nombre", "RUC", "Ciudad", "Correo", "Teléfono", "Estado", "Código registro", "Afiliados", "Compras", "Ventas USD", "Puntos generados", "Creado"],
            list.map((d) => [d.id, d.name, d.ruc, d.city, d.email, d.phone, d.status, d.registrationCode, d.affiliateCount, d.purchaseCount, (d.salesCents / 100).toFixed(2), d.pointsGenerated, fmtDate(d.createdAt)]))}>
            <Download className="size-4" /> CSV</Button>
          <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> Nuevo distribuidor</Button>
        </>} />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted" />
        <Input className="pl-10" placeholder="Buscar por nombre, ciudad, código o correo" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {dists.loading ? <PageLoader /> : !list.length ? <Card><Empty icon={<Building2 className="size-5" />} title="No hay distribuidores">Crea el primero para que pueda registrar compras.</Empty></Card> : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 border-b border-line bg-paper/60 px-5 py-3 text-xs font-bold uppercase tracking-wide text-muted md:grid">
            <span>Distribuidor</span><span className="text-right">Afiliados</span><span className="text-right">Compras</span><span className="text-right">Ventas</span><span className="text-right">Puntos</span><span className="w-5" />
          </div>
          <ul className="divide-y divide-line">
            {list.map((d) => <Row key={d.id} d={d} />)}
          </ul>
        </Card>
      )}
      <DistributorForm open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function Row({ d }: { d: WithId<Distributor> }) {
  return (
    <li>
      <Link to={`/admin/distribuidores/${d.id}`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3.5 hover:bg-paper/60 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] md:gap-4 md:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><p className="truncate font-bold">{d.name}</p><StatusBadge status={d.status} /></div>
          <p className="truncate text-xs text-muted">{d.city ?? "—"} · {d.registrationCode} · {d.email}</p>
          <p className="mt-1 text-xs text-ink-2 md:hidden">{formatPoints(d.affiliateCount)} afiliados · {formatPoints(d.purchaseCount)} compras · {formatPoints(d.pointsGenerated)} pts</p>
        </div>
        <span className="tabular hidden text-right font-semibold md:block">{formatPoints(d.affiliateCount)}</span>
        <span className="tabular hidden text-right font-semibold md:block">{formatPoints(d.purchaseCount)}</span>
        <span className="tabular hidden text-right font-semibold md:block">{formatUsd(d.salesCents)}</span>
        <span className="tabular hidden text-right font-semibold md:block">{formatPoints(d.pointsGenerated)}</span>
        <ChevronRight className="size-5 text-muted" />
      </Link>
    </li>
  );
}

export function DistributorForm({ open, onClose, existing }: { open: boolean; onClose: () => void; existing?: WithId<Distributor> }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({
    name: existing?.name ?? "", ruc: existing?.ruc ?? "", contactName: existing?.contactName ?? "", email: existing?.email ?? "", phone: existing?.phone ?? "",
    city: existing?.city ?? "", province: existing?.province ?? "", address: existing?.address ?? "", password: "",
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ code: string; email: string; password: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const close = () => { setCreated(null); setErr(null); onClose(); };

  return (
    <Sheet open={open} onClose={close} title={existing ? "Editar distribuidor" : "Nuevo distribuidor"} wide>
      {created ? (
        <div className="space-y-4">
          <Alert tone="ok">Distribuidor creado. Entrega estas credenciales de forma segura; podrá iniciar sesión de inmediato.</Alert>
          <dl className="space-y-2 rounded-2xl bg-paper p-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Usuario</dt><dd className="font-bold">{created.email}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Contraseña temporal</dt><dd className="font-mono font-bold">{created.password}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Código de registro</dt><dd className="font-bold">{created.code}</dd></div>
          </dl>
          <Button block onClick={close}>Listo</Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setErr(null); setBusy(true);
          try {
            if (existing) {
              const { password: _pw, ...rest } = f; void _pw;
              await api.updateDistributor({ id: existing.id, ...rest }); toast("Distribuidor actualizado"); close();
            } else {
              const r = await api.createDistributor(f); setCreated({ code: r.registrationCode, email: f.email, password: f.password });
            }
          } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
        }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre comercial *" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} required /></Field>
            <Field label="RUC"><Input value={f.ruc} onChange={set("ruc")} inputMode="numeric" maxLength={13} /></Field>
            <Field label="Persona de contacto"><Input value={f.contactName} onChange={set("contactName")} /></Field>
            <Field label="Correo de acceso *" hint="Con este correo inicia sesión."><Input type="email" value={f.email} onChange={set("email")} required /></Field>
            <Field label="Teléfono"><Input type="tel" value={f.phone} onChange={set("phone")} /></Field>
            <Field label="Ciudad"><Input value={f.city} onChange={set("city")} /></Field>
            <Field label="Provincia"><Input value={f.province} onChange={set("province")} /></Field>
            <Field label="Dirección" className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
            {!existing && <Field label="Contraseña inicial *" hint="Mínimo 8 caracteres." className="sm:col-span-2"><Input value={f.password} onChange={set("password")} minLength={8} required autoComplete="new-password" /></Field>}
          </div>
          {err && <Alert tone="bad">{err}</Alert>}
          <Button type="submit" block size="lg" loading={busy}>{existing ? "Guardar cambios" : "Crear distribuidor y cuenta"}</Button>
        </form>
      )}
    </Sheet>
  );
}
