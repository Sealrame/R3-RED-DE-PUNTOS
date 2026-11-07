import { useState } from "react";
import { KeyRound, Power } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Alert, Button, Field, Input, Sheet, Textarea, useToast } from "./ui";

/** Activar/desactivar cuenta y restablecer contraseña (solo admin). */
export function AccountActions({ targetType, id, status, name }: { targetType: "distributor" | "affiliate"; id: string; status: string; name: string }) {
  const toast = useToast();
  const [sheet, setSheet] = useState<"status" | "password" | null>(null);
  const [reason, setReason] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const next = status === "active" ? "inactive" : "active";
  const close = () => { setSheet(null); setErr(null); setReason(""); setPw(""); };
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setSheet("password")}><KeyRound className="size-4" /> Restablecer contraseña</Button>
      <Button variant={status === "active" ? "secondary" : "primary"} size="sm" onClick={() => setSheet("status")} className={status === "active" ? "text-bad" : ""}>
        <Power className="size-4" /> {status === "active" ? "Desactivar" : "Activar"}
      </Button>
      <Sheet open={sheet === "status"} onClose={close} title={`${next === "inactive" ? "Desactivar" : "Activar"} a ${name}`}>
        <div className="space-y-4">
          {next === "inactive" && <Alert tone="warn">Se cerrarán sus sesiones y no podrá ingresar{targetType === "distributor" ? " ni registrar compras" : " ni acumular puntos"}. El historial y saldo se conservan.</Alert>}
          <Field label="Motivo (queda en auditoría)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {err && <Alert tone="bad">{err}</Alert>}
          <Button block variant={next === "inactive" ? "danger" : "primary"} loading={busy} disabled={reason.trim().length < 5} onClick={async () => {
            setBusy(true); setErr(null);
            try { await api.setAccountStatus({ targetType, id, status: next, reason }); toast(next === "inactive" ? "Cuenta desactivada" : "Cuenta activada"); close(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
          }}>Confirmar</Button>
        </div>
      </Sheet>
      <Sheet open={sheet === "password"} onClose={close} title="Restablecer contraseña">
        <div className="space-y-4">
          <p className="text-sm text-ink-2">Define una contraseña temporal para <b>{name}</b>. Se cerrarán sus sesiones activas.</p>
          <Field label="Nueva contraseña" hint="Mínimo 8 caracteres."><Input value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          {err && <Alert tone="bad">{err}</Alert>}
          <Button block loading={busy} disabled={pw.length < 8} onClick={async () => {
            setBusy(true); setErr(null);
            try { await api.resetUserPassword({ targetType, id, password: pw }); toast("Contraseña restablecida"); close(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
          }}>Guardar</Button>
        </div>
      </Sheet>
    </>
  );
}
