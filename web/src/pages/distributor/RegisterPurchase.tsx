import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { doc } from "firebase/firestore";
import { AlertTriangle, ArrowLeft, CheckCircle2, Delete, Keyboard, Search, UserRound } from "lucide-react";
import { db } from "@/lib/firebase";
import { useDoc, useDebounced } from "@/lib/hooks";
import { api, errorMessage, errorReason, newKey, type AffiliateLookup } from "@/lib/api";
import { formatPoints, formatUsd } from "@/lib/format";
import { Alert, Badge, Button, Card, Input, Sheet, Spinner, cx } from "@/components/ui";
import { QrScanner } from "@/components/Qr";
import { DEFAULT_POINTS_CONFIG, calculatePoints, parseAmountToCents, validatePurchaseAmount, type PointsConfig } from "@shared/domain";

type Step = "identify" | "amount" | "confirm" | "done";

export default function RegisterPurchase() {
  const [step, setStep] = useState<Step>("identify");
  const [aff, setAff] = useState<AffiliateLookup | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<{ points: number; transactionId: string; amountCents: number } | null>(null);
  const cfgDoc = useDoc<PointsConfig>(() => doc(db, "config", "points"), []);
  const cfg = { ...DEFAULT_POINTS_CONFIG, ...(cfgDoc.data ?? {}) };

  const reset = () => { setStep("identify"); setAff(null); setAmount(""); setReference(""); setResult(null); };

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-5 flex items-center gap-3">
        {step !== "identify" && step !== "done" ? (
          <button onClick={() => setStep(step === "confirm" ? "amount" : "identify")} className="grid size-10 place-items-center rounded-full bg-surface shadow-sm ring-1 ring-line" aria-label="Atrás"><ArrowLeft className="size-5" /></button>
        ) : step === "identify" ? (
          <Link to="/distribuidor" className="grid size-10 place-items-center rounded-full bg-surface shadow-sm ring-1 ring-line" aria-label="Volver"><ArrowLeft className="size-5" /></Link>
        ) : null}
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Registrar compra</h1>
          <Steps step={step} />
        </div>
      </div>

      {step === "identify" && <Identify onFound={(a) => { setAff(a); setStep("amount"); }} />}
      {step === "amount" && aff && (
        <AmountStep aff={aff} cfg={cfg} amount={amount} setAmount={setAmount} reference={reference} setReference={setReference} onNext={() => setStep("confirm")} />
      )}
      {step === "confirm" && aff && (
        <ConfirmStep aff={aff} cfg={cfg} amountCents={parseAmountToCents(amount)!} reference={reference}
          onDone={(r) => { setResult(r); setStep("done"); }} />
      )}
      {step === "done" && aff && result && (
        <div className="text-center animate-rise">
          <div className="mx-auto mt-6 grid size-24 place-items-center rounded-full bg-brand-100 text-brand-700 animate-pop"><CheckCircle2 className="size-14" /></div>
          <p className="mt-6 text-sm font-semibold text-muted">Puntos acreditados a {aff.fullName}</p>
          <p className="tabular mt-1 text-6xl font-extrabold tracking-tight text-brand-700">+{formatPoints(result.points)}</p>
          <p className="mt-2 text-sm text-ink-2">Compra de {formatUsd(result.amountCents)}</p>
          <p className="mt-1 break-all text-[11px] text-muted">ID: {result.transactionId}</p>
          <div className="mt-8 grid gap-3">
            <Button size="lg" block onClick={reset}>Registrar otra compra</Button>
            <Link to="/distribuidor"><Button variant="ghost" block>Volver al inicio</Button></Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const idx = { identify: 0, amount: 1, confirm: 2, done: 3 }[step];
  const labels = ["Socio", "Monto", "Confirmar"];
  return (
    <div className="mt-1 flex items-center gap-1.5">
      {labels.map((l, i) => (
        <span key={l} className={cx("flex items-center gap-1 text-[11px] font-bold", i <= idx ? "text-brand-700" : "text-muted")}>
          <span className={cx("h-1.5 w-6 rounded-full", i <= idx ? "bg-brand-500" : "bg-line-strong")} />{l}
        </span>
      ))}
    </div>
  );
}

function Identify({ onFound }: { onFound: (a: AffiliateLookup) => void }) {
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 350);
  const [results, setResults] = useState<AffiliateLookup[] | null>(null);
  const lastScan = useRef("");

  const lookup = async (content: string) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const a = await api.lookupAffiliate({ content });
      if (a.status !== "active") { setErr(`${a.fullName} tiene la cuenta inactiva y no puede acumular puntos.`); return; }
      navigator.vibrate?.(60);
      onFound(a);
    } catch (e) { setErr(errorMessage(e)); setTimeout(() => (lastScan.current = ""), 2500); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (dq.trim().length < 3) { setResults(null); return; }
    let live = true;
    api.searchAffiliates({ q: dq.trim() }).then((r) => live && setResults(r.results)).catch((e) => live && setErr(errorMessage(e)));
    return () => { live = false; };
  }, [dq]);

  return (
    <div className="space-y-4 animate-rise">
      {mode === "scan" ? (
        <>
          <QrScanner paused={busy} onResult={(t) => { if (t !== lastScan.current) { lastScan.current = t; lookup(t); } }} />
          {busy && <p className="flex items-center justify-center gap-2 text-sm font-semibold text-ink-2"><Spinner /> Identificando socio…</p>}
          {err && <Alert tone="bad">{err}</Alert>}
          <Button variant="secondary" block onClick={() => { setMode("manual"); setErr(null); }}><Keyboard className="size-4" /> Ingresar código o buscar</Button>
        </>
      ) : (
        <>
          <Card className="p-4">
            <p className="mb-2 text-sm font-bold">Código de socio</p>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) lookup(code.trim()); }}>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AF-XXXXXXX" autoCapitalize="characters" className="tabular tracking-wider" />
              <Button type="submit" loading={busy}>Buscar</Button>
            </form>
          </Card>
          <Card className="p-4">
            <p className="mb-2 text-sm font-bold">Buscar por nombre, cédula o teléfono</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted" />
              <Input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej. María Pérez" />
            </div>
            {results && (
              <ul className="mt-3 divide-y divide-line">
                {results.length === 0 && <li className="py-3 text-sm text-muted">Sin resultados.</li>}
                {results.map((r) => (
                  <li key={r.id}>
                    <button className="flex w-full items-center gap-3 py-3 text-left" onClick={() => r.status === "active" ? onFound(r) : setErr("Cuenta inactiva.")}>
                      <span className="grid size-9 place-items-center rounded-full bg-paper text-ink-2"><UserRound className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{r.fullName}</span><span className="tabular text-xs text-muted">{r.code} · ID {r.idMasked}</span></span>
                      {r.status !== "active" && <Badge>Inactivo</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {err && <Alert tone="bad">{err}</Alert>}
          <Button variant="ghost" block onClick={() => { setMode("scan"); setErr(null); }}>Volver a escanear</Button>
        </>
      )}
    </div>
  );
}

function AffiliateChip({ aff }: { aff: AffiliateLookup }) {
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <span className="grid size-11 place-items-center rounded-2xl bg-brand-900 text-sm font-extrabold text-gold">
        {aff.fullName.split(" ").slice(0, 2).map((p) => p[0]).join("")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{aff.fullName}</p>
        <p className="tabular text-xs text-muted">{aff.code} · ID {aff.idMasked}</p>
      </div>
      {aff.linkedToYou && <Badge tone="ok">Tu afiliado</Badge>}
    </Card>
  );
}

function AmountStep({ aff, cfg, amount, setAmount, reference, setReference, onNext }: {
  aff: AffiliateLookup; cfg: PointsConfig; amount: string; setAmount: (v: string) => void; reference: string; setReference: (v: string) => void; onNext: () => void;
}) {
  const cents = parseAmountToCents(amount || "0") ?? 0;
  const validation = amount ? validatePurchaseAmount(cents, cfg) : null;
  const press = (k: string) => {
    if (k === "del") return setAmount(amount.slice(0, -1));
    if (k === "." && (amount.includes(".") || !amount)) return setAmount(amount ? amount : "0.");
    const next = amount === "0" && k !== "." ? k : amount + k;
    if (/^\d{0,7}(\.\d{0,2})?$/.test(next)) setAmount(next);
  };
  return (
    <div className="space-y-4 animate-rise">
      <AffiliateChip aff={aff} />
      <div className="py-4 text-center">
        <p className="text-sm font-semibold text-muted">Monto de la compra (USD)</p>
        <p className={cx("tabular mt-2 text-6xl font-extrabold tracking-tight", !amount && "text-line-strong")}>${amount || "0"}</p>
        <p className="mt-3 text-sm font-semibold text-brand-700">{cents > 0 ? `≈ ${formatPoints(calculatePoints(cents, cfg))} puntos` : `${cfg.pointsPerDollar} punto${cfg.pointsPerDollar === 1 ? "" : "s"} por cada $1`}</p>
        {validation && !validation.ok && <p className="mt-1 text-xs font-semibold text-bad">{validation.reason}</p>}
      </div>
      {/* Teclado numérico propio: rápido y sin errores de formato regional */}
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((k) => (
          <button key={k} type="button" onClick={() => press(k)}
            className="h-14 rounded-2xl bg-surface text-xl font-bold shadow-sm ring-1 ring-line transition active:scale-95 active:bg-paper">
            {k === "del" ? <Delete className="mx-auto size-6" /> : k}
          </button>
        ))}
      </div>
      <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N.º de factura o referencia (opcional)" maxLength={60} />
      <Button size="lg" block disabled={!validation?.ok} onClick={onNext}>Continuar</Button>
    </div>
  );
}

function ConfirmStep({ aff, cfg, amountCents, reference, onDone }: { aff: AffiliateLookup; cfg: PointsConfig; amountCents: number; reference: string; onDone: (r: { points: number; transactionId: string; amountCents: number }) => void }) {
  // La clave de idempotencia se fija al entrar a confirmación: reintentos o doble toque NO duplican la acreditación.
  const key = useMemo(() => newKey(), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const estimate = calculatePoints(amountCents, cfg);

  const submit = async (confirmDuplicate = false) => {
    setBusy(true); setErr(null);
    try {
      const r = await api.registerPurchase({ affiliateId: aff.id, amountCents, idempotencyKey: key, reference: reference || undefined, confirmDuplicate });
      navigator.vibrate?.([40, 40, 80]);
      onDone({ points: r.points, transactionId: r.transactionId, amountCents });
    } catch (e) {
      if (errorReason(e) === "possible-duplicate") setDup(errorMessage(e));
      else setErr(errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 animate-rise">
      <AffiliateChip aff={aff} />
      <Card className="divide-y divide-line">
        <div className="flex items-center justify-between p-4"><span className="text-sm text-muted">Monto de compra</span><span className="tabular text-lg font-extrabold">{formatUsd(amountCents)}</span></div>
        {reference && <div className="flex items-center justify-between p-4"><span className="text-sm text-muted">Referencia</span><span className="text-sm font-semibold">{reference}</span></div>}
        <div className="flex items-center justify-between p-4"><span className="text-sm text-muted">Regla vigente</span><span className="text-sm font-semibold">$1 = {cfg.pointsPerDollar} pt · {cfg.rounding === "floor" ? "redondeo hacia abajo" : cfg.rounding === "ceil" ? "redondeo hacia arriba" : "redondeo normal"}</span></div>
        <div className="flex items-center justify-between bg-brand-50 p-4"><span className="text-sm font-bold text-brand-700">Puntos a acreditar</span><span className="tabular text-3xl font-extrabold text-brand-700">{formatPoints(estimate)}</span></div>
      </Card>
      <p className="text-center text-xs text-muted">El servidor calcula y valida los puntos de forma definitiva al confirmar.</p>
      {err && <Alert tone="bad">{err}</Alert>}
      <Button size="lg" block loading={busy} onClick={() => submit(false)}>Confirmar y acreditar</Button>

      <Sheet open={!!dup} onClose={() => setDup(null)} title="¿Compra duplicada?">
        <div className="space-y-4">
          <div className="flex gap-3 rounded-2xl bg-warn-bg p-4 text-sm text-warn"><AlertTriangle className="size-5 shrink-0" /><p>{dup}</p></div>
          <p className="text-sm text-ink-2">Si realmente es una <b>nueva compra</b> por el mismo monto, puedes registrarla. Quedará marcada para revisión del administrador.</p>
          <div className="grid gap-2">
            <Button variant="secondary" block onClick={() => setDup(null)}>No, cancelar</Button>
            <Button block loading={busy} onClick={() => { setDup(null); submit(true); }}>Sí, es otra compra</Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
