import { useEffect, useState } from "react";
import { doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useDoc } from "@/lib/hooks";
import { api, errorMessage } from "@/lib/api";
import { formatPoints, formatUsd } from "@/lib/format";
import { DEFAULT_POINTS_CONFIG, calculatePoints, parseAmountToCents, type PointsConfig, type Rounding } from "@shared/domain";
import { Alert, Button, Card, Field, Input, PageHeader, PageLoader, SectionTitle, Select, useToast } from "@/components/ui";
import { QrActions, QrImage } from "@/components/Qr";
import { registrationUrl } from "../distributor/RegistrationQr";

export default function Settings() {
  const cfg = useDoc<PointsConfig>(() => doc(db, "config", "points"), []);
  const toast = useToast();
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (cfg.loading) return;
    const c = { ...DEFAULT_POINTS_CONFIG, ...(cfg.data ?? {}) };
    setF({
      pointsPerDollar: String(c.pointsPerDollar), rounding: c.rounding, min: (c.minPurchaseCents / 100).toFixed(2), max: (c.maxPurchaseCents / 100).toFixed(2),
      dup: String(c.duplicateWindowSeconds), pointValue: String(c.pointValueUsd), requireDist: c.requireDistributorOnSignup,
    });
  }, [cfg.loading, cfg.data]);
  if (cfg.loading || !("rounding" in f)) return <PageLoader />;

  const preview = { pointsPerDollar: Number(f.pointsPerDollar) || 0, rounding: f.rounding as Rounding };
  const examples = [1000, 15000, 25050];

  return (
    <div className="space-y-6">
      <PageHeader title="Configuración" subtitle="Reglas de acumulación y equivalencias. Cada cambio queda auditado." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <SectionTitle>Reglas de acumulación</SectionTitle>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault(); setErr(null);
            const minC = parseAmountToCents(String(f.min)), maxC = parseAmountToCents(String(f.max));
            if (minC === null || maxC === null) { setErr("Montos mínimo/máximo inválidos."); return; }
            setBusy(true);
            try {
              await api.updatePointsConfig({
                pointsPerDollar: Number(f.pointsPerDollar), rounding: f.rounding as Rounding, minPurchaseCents: minC, maxPurchaseCents: maxC,
                duplicateWindowSeconds: Number(f.dup), pointValueUsd: Number(f.pointValue), requireDistributorOnSignup: f.requireDist === true,
              });
              toast("Configuración guardada");
            } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
          }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Puntos por cada $1" hint="Regla base: 1"><Input inputMode="decimal" value={String(f.pointsPerDollar)} onChange={(e) => setF({ ...f, pointsPerDollar: e.target.value })} /></Field>
              <Field label="Redondeo de puntos">
                <Select value={String(f.rounding)} onChange={(e) => setF({ ...f, rounding: e.target.value })}>
                  <option value="floor">Hacia abajo ($250.50 → 250)</option><option value="round">Al más cercano</option><option value="ceil">Hacia arriba</option>
                </Select>
              </Field>
              <Field label="Compra mínima (USD)"><Input inputMode="decimal" value={String(f.min)} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
              <Field label="Compra máxima por operación (USD)" hint="Evita errores de digitación"><Input inputMode="decimal" value={String(f.max)} onChange={(e) => setF({ ...f, max: e.target.value })} /></Field>
              <Field label="Ventana anti-duplicados (segundos)" hint="Compras iguales en este lapso requieren confirmación"><Input inputMode="numeric" value={String(f.dup)} onChange={(e) => setF({ ...f, dup: e.target.value })} /></Field>
              <Field label="Valor referencial de 1 punto (USD)" hint="Equivalencia informativa para premios"><Input inputMode="decimal" value={String(f.pointValue)} onChange={(e) => setF({ ...f, pointValue: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2.5 text-sm font-semibold"><input type="checkbox" className="size-4 accent-ink" checked={f.requireDist === true} onChange={(e) => setF({ ...f, requireDist: e.target.checked })} /> Exigir QR o código de distribuidor para registrarse</label>
            {err && <Alert tone="bad">{err}</Alert>}
            <Button type="submit" loading={busy}>Guardar reglas</Button>
          </form>
        </Card>
        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Vista previa</SectionTitle>
            <ul className="space-y-2 text-sm">
              {examples.map((c) => <li key={c} className="flex justify-between"><span className="text-muted">Compra de {formatUsd(c)}</span><b className="tabular">{formatPoints(calculatePoints(c, preview))} pts</b></li>)}
            </ul>
            <p className="mt-3 text-xs text-muted">1.000 pts ≈ {formatUsd(Math.round(Number(f.pointValue) * 1000 * 100))} en premios</p>
          </Card>
          <Card className="p-5 text-center">
            <SectionTitle>QR de registro general</SectionTitle>
            <p className="mb-3 text-left text-xs text-muted">Para campañas de toda la red. Los socios no quedan vinculados a un distribuidor hasta su primera compra.</p>
            <div className="mx-auto w-fit rounded-2xl bg-white p-2 ring-1 ring-line"><QrImage value={registrationUrl()} size={160} /></div>
            <div className="mt-3"><QrActions value={registrationUrl()} title="Únete y acumula puntos" subtitle={location.host} filename="qr-registro-red.png" /></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
