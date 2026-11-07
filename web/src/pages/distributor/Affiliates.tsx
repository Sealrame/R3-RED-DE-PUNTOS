import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { QrCode, Search, UserRound, Users } from "lucide-react";
import { api, errorMessage, type AffiliateLookup } from "@/lib/api";
import { useDebounced } from "@/lib/hooks";
import { formatPoints } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Input, PageHeader, Spinner, Stat } from "@/components/ui";
import { useMyDistributor } from "./data";

export default function DistributorAffiliates() {
  const d = useMyDistributor();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 350);
  const [res, setRes] = useState<AffiliateLookup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (dq.trim().length < 2) { setRes(null); return; }
    let live = true;
    setBusy(true); setErr(null);
    api.searchAffiliates({ q: dq.trim() }).then((r) => live && setRes(r.results)).catch((e) => live && setErr(errorMessage(e))).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [dq]);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Afiliados" subtitle="Busca socios de toda la red para registrar sus compras." actions={<Link to="/distribuidor/registro-qr"><Button variant="secondary" size="sm"><QrCode className="size-4" /> Invitar socios</Button></Link>} />
      <Stat label="Afiliados vinculados a tu distribuidor" value={formatPoints(d.data?.affiliateCount ?? 0)} icon={<Users className="size-4" />} sub="Registrados con tu QR o cuya primera compra registraste." />
      <Card className="p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted" />
          <Input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código AF-…, nombre, cédula o teléfono" autoFocus />
          {busy && <Spinner className="absolute right-3 top-3" />}
        </div>
        {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
        {res && (res.length === 0 ? <Empty title="Sin resultados" /> : (
          <ul className="mt-3 divide-y divide-line">
            {res.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-3">
                <span className="grid size-10 place-items-center rounded-full bg-paper text-ink-2"><UserRound className="size-4" /></span>
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{r.fullName}</p><p className="tabular text-xs text-muted">{r.code} · ID {r.idMasked}</p></div>
                {r.linkedToYou && <Badge tone="ok">Vinculado</Badge>}
                {r.status !== "active" && <Badge>Inactivo</Badge>}
              </li>
            ))}
          </ul>
        ))}
      </Card>
      <p className="text-xs text-muted">Por privacidad, los distribuidores no ven saldos ni datos de contacto de los socios.</p>
    </div>
  );
}
