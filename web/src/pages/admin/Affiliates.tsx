import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { ChevronRight, Download, Search, Users } from "lucide-react";
import { db } from "@/lib/firebase";
import { useDebounced, useQuery } from "@/lib/hooks";
import { api, errorMessage, type AffiliateLookup } from "@/lib/api";
import type { Affiliate } from "@/lib/types";
import { fmtDate, formatPoints } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { Alert, Button, Card, Empty, Input, PageHeader, PageLoader, Select, Spinner, StatusBadge } from "@/components/ui";
import { QrScanner } from "@/components/Qr";
import { Sheet } from "@/components/ui";
import { useAllDistributors } from "./data";
import { useNavigate } from "react-router-dom";

export default function AdminAffiliates() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 350);
  const [res, setRes] = useState<AffiliateLookup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dist, setDist] = useState("");
  const [n, setN] = useState(50);
  const [scan, setScan] = useState(false);
  const nav = useNavigate();
  const dists = useAllDistributors();
  const recent = useQuery<Affiliate>(() => query(collection(db, "affiliates"), ...(dist ? [where("distributorId", "==", dist)] : []), orderBy("createdAt", "desc"), limit(n)), [dist, n]);

  useEffect(() => {
    if (dq.trim().length < 2) { setRes(null); return; }
    let live = true; setBusy(true); setErr(null);
    api.searchAffiliates({ q: dq.trim() }).then((r) => live && setRes(r.results)).catch((e) => live && setErr(errorMessage(e))).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [dq]);

  return (
    <div>
      <PageHeader title="Afiliados" subtitle="Busca por nombre, teléfono, identificación, código o QR."
        actions={<Button variant="secondary" size="sm" disabled={!recent.data.length} onClick={() => downloadCsv("afiliados.csv",
          ["ID", "Código", "Nombre", "Tipo ID", "Identificación", "Teléfono", "Correo", "Distribuidor", "Estado", "Registro"],
          recent.data.map((a) => [a.id, a.code, a.fullName, a.idType, a.idNumber, a.phone, a.email, a.distributorName, a.status, fmtDate(a.createdAt)]))}>
          <Download className="size-4" /> CSV (lista cargada)</Button>} />
      <div className="mb-5 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted" />
          <Input className="pl-10" placeholder="María, 0991234567, 1710034065, AF-…" value={q} onChange={(e) => setQ(e.target.value)} />
          {busy && <Spinner className="absolute right-3 top-3" />}
        </div>
        <Button variant="secondary" onClick={() => setScan(true)}>Escanear QR</Button>
      </div>
      {err && <div className="mb-4"><Alert tone="bad">{err}</Alert></div>}
      {res ? (
        <Card className="overflow-hidden">
          {res.length === 0 ? <Empty title="Sin resultados" /> : (
            <ul className="divide-y divide-line">
              {res.map((a) => (
                <li key={a.id}><Link to={`/admin/afiliados/${a.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-paper/60">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><p className="truncate font-bold">{a.fullName}</p><StatusBadge status={a.status} /></div>
                    <p className="truncate text-xs text-muted">{a.code} · {a.idNumber} · {a.phone} · {a.distributorName ?? "Sin distribuidor"}</p>
                  </div>
                  <span className="tabular text-right font-extrabold">{formatPoints(a.balance ?? 0)}<span className="block text-[11px] font-medium text-muted">pts</span></span>
                  <ChevronRight className="size-5 text-muted" />
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-bold">Registros recientes</h2>
            <Select value={dist} onChange={(e) => { setDist(e.target.value); setN(50); }} className="h-9 w-auto! max-w-56 text-sm" aria-label="Filtrar por distribuidor">
              <option value="">Todos los distribuidores</option>
              {dists.data.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.affiliateCount})</option>)}
            </Select>
          </div>
          <Card className="overflow-hidden">
            {recent.loading && !recent.data.length ? <PageLoader /> : !recent.data.length ? <Empty icon={<Users className="size-5" />} title="Sin afiliados" /> : (
              <ul className="divide-y divide-line">
                {recent.data.map((a) => (
                  <li key={a.id}><Link to={`/admin/afiliados/${a.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-paper/60">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><p className="truncate font-bold">{a.fullName}</p><StatusBadge status={a.status} /></div>
                      <p className="truncate text-xs text-muted">{a.code} · {a.phone} · {a.distributorName ?? "Sin distribuidor"} · {fmtDate(a.createdAt)}</p>
                    </div>
                    <ChevronRight className="size-5 text-muted" />
                  </Link></li>
                ))}
              </ul>
            )}
            {recent.data.length >= n && <Button variant="ghost" block onClick={() => setN(n + 50)}>Cargar más</Button>}
          </Card>
        </>
      )}
      <Sheet open={scan} onClose={() => setScan(false)} title="Escanear QR de socio">
        {scan && <QrScanner onResult={async (t) => {
          try { const a = await api.lookupAffiliate({ content: t }); setScan(false); nav(`/admin/afiliados/${a.id}`); } catch (e) { setErr(errorMessage(e)); setScan(false); }
        }} />}
      </Sheet>
    </div>
  );
}
