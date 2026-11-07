import { useEffect, useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { api, errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Alert, Button, Card, Field, Input, PageHeader, PageLoader, SectionTitle, useToast } from "@/components/ui";
import { normalizeEcPhone } from "@shared/domain";
import { useMyAffiliate } from "./data";

export default function Profile() {
  const { aff } = useMyAffiliate();
  const toast = useToast();
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);

  useEffect(() => { if (aff.data) { setPhone(aff.data.phone); setEmail(aff.data.email ?? ""); } }, [aff.data?.phone, aff.data?.email]); // eslint-disable-line
  if (aff.loading || !aff.data) return <PageLoader />;
  const a = aff.data;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title="Mi perfil" />
      <Card className="p-5">
        <SectionTitle>Datos de la cuenta</SectionTitle>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-muted">Nombre</dt><dd className="font-semibold">{a.fullName}</dd></div>
          <div><dt className="text-muted">Código</dt><dd className="tabular font-semibold">{a.code}</dd></div>
          <div><dt className="text-muted">Identificación</dt><dd className="font-semibold">{a.idNumber}</dd></div>
          <div><dt className="text-muted">Socio desde</dt><dd className="font-semibold">{fmtDate(a.createdAt)}</dd></div>
          {a.distributorName && <div className="col-span-2"><dt className="text-muted">Distribuidor de origen</dt><dd className="font-semibold">{a.distributorName}</dd></div>}
        </dl>
        <p className="mt-4 text-xs text-muted">Para corregir tu nombre o identificación contacta al administrador.</p>
      </Card>
      <Card className="p-5">
        <SectionTitle>Datos de contacto</SectionTitle>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setErr(null);
          if (!normalizeEcPhone(phone)) { setErr("Celular inválido."); return; }
          setBusy(true);
          try { await api.updateMyProfile({ phone, email: email.trim() || undefined }); toast("Datos actualizados"); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
        }}>
          <Field label="Celular"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Correo (opcional)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {err && <Alert tone="bad">{err}</Alert>}
          <Button type="submit" loading={busy}>Guardar cambios</Button>
        </form>
      </Card>
      <Card className="p-5">
        <SectionTitle>Cambiar contraseña</SectionTitle>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setPwErr(null);
          if (pw.next.length < 8) { setPwErr("La nueva contraseña debe tener al menos 8 caracteres."); return; }
          const u = auth.currentUser!;
          setPwBusy(true);
          try {
            await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email!, pw.current));
            await updatePassword(u, pw.next);
            setPw({ current: "", next: "" }); toast("Contraseña actualizada");
          } catch (e) { setPwErr(errorMessage(e)); } finally { setPwBusy(false); }
        }}>
          <Field label="Contraseña actual"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="Nueva contraseña"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          {pwErr && <Alert tone="bad">{pwErr}</Alert>}
          <Button type="submit" variant="secondary" loading={pwBusy}>Actualizar contraseña</Button>
        </form>
      </Card>
    </div>
  );
}
