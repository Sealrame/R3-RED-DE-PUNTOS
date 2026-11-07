import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Building2, CheckCircle2 } from "lucide-react";
import { useSession } from "@/auth/AuthProvider";
import { api, errorMessage } from "@/lib/api";
import { BRAND } from "@/lib/firebase";
import { Alert, Button, Field, Input, Segmented } from "@/components/ui";
import { normalizeEcPhone, validateIdNumber, type IdType } from "@shared/domain";
import { AuthLayout } from "./AuthLayout";

export default function Register() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const s = useSession();
  const [code, setCode] = useState((params.get("d") ?? "").toUpperCase());
  const [dist, setDist] = useState<{ valid: boolean; name?: string; city?: string | null } | null>(null);
  const [f, setF] = useState({ fullName: "", idType: "cedula" as IdType, idNumber: "", phone: "", email: "", password: "", password2: "", acceptTerms: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ code: string } | null>(null);

  useEffect(() => {
    if (!/^D-[A-Z0-9]{5}$/.test(code)) { setDist(null); return; }
    let live = true;
    api.resolveRegistrationCode({ code }).then((r) => live && setDist(r)).catch(() => live && setDist({ valid: false }));
    return () => { live = false; };
  }, [code]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (f.fullName.trim().split(/\s+/).length < 2) e.fullName = "Escribe nombre y apellido.";
    if (!validateIdNumber(f.idType, f.idNumber)) e.idNumber = f.idType === "cedula" ? "Cédula inválida (10 dígitos)." : f.idType === "ruc" ? "RUC inválido (13 dígitos)." : "Pasaporte inválido.";
    if (!normalizeEcPhone(f.phone)) e.phone = "Celular inválido. Ej. 0991234567";
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) e.email = "Correo inválido.";
    if (f.password.length < 8) e.password = "Mínimo 8 caracteres.";
    if (f.password !== f.password2) e.password2 = "Las contraseñas no coinciden.";
    if (!f.acceptTerms) e.acceptTerms = "Debes aceptar para continuar.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setErr(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const r = await api.registerAffiliate({
        fullName: f.fullName.trim(), idType: f.idType, idNumber: f.idNumber.trim().toUpperCase(), phone: f.phone,
        email: f.email.trim() || undefined, password: f.password, distributorCode: dist?.valid ? code : undefined, acceptTerms: f.acceptTerms,
      });
      await s.login(f.idNumber, f.password);
      await s.refreshClaims();
      setDone({ code: r.code });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  if (done)
    return (
      <AuthLayout>
        <div className="text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-brand-100 text-brand-700 animate-pop"><CheckCircle2 className="size-9" /></div>
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight">¡Bienvenido a {BRAND}!</h1>
          <p className="mt-2 text-sm text-muted">Tu código de socio es</p>
          <p className="tabular mt-1 text-2xl font-extrabold tracking-wider">{done.code}</p>
          <p className="mt-4 text-sm text-ink-2">Muestra tu QR personal en cada compra para acumular puntos.</p>
          <Button size="lg" block className="mt-6" onClick={() => nav("/socio/qr", { replace: true })}>Ver mi QR</Button>
        </div>
      </AuthLayout>
    );

  return (
    <AuthLayout>
      <h1 className="text-[28px] font-extrabold tracking-tight">Crea tu cuenta de socio</h1>
      <p className="mt-1 text-sm text-muted">Gratis. Acumula 1 punto por cada $1 en toda la red.</p>

      {dist?.valid ? (
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-brand-100 bg-brand-50 p-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white text-brand-700"><Building2 className="size-5" /></span>
          <div className="min-w-0 text-sm"><p className="text-xs text-muted">Te registras con</p><p className="truncate font-bold">{dist.name}{dist.city ? ` · ${dist.city}` : ""}</p></div>
        </div>
      ) : dist && !dist.valid ? <div className="mt-5"><Alert tone="warn">El código de distribuidor <b>{code}</b> no es válido. Puedes registrarte sin él.</Alert></div> : null}

      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <Field label="Nombre completo" error={errors.fullName}><Input value={f.fullName} onChange={(e) => set("fullName", e.target.value)} autoComplete="name" placeholder="Nombres y apellidos" /></Field>
        <div>
          <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">Identificación</span>
          <Segmented value={f.idType} onChange={(v) => set("idType", v)} options={[{ value: "cedula", label: "Cédula" }, { value: "ruc", label: "RUC" }, { value: "pasaporte", label: "Pasaporte" }]} />
          <Input className="mt-2" value={f.idNumber} onChange={(e) => set("idNumber", e.target.value.replace(/\s/g, ""))} inputMode={f.idType === "pasaporte" ? "text" : "numeric"} placeholder={f.idType === "cedula" ? "10 dígitos" : f.idType === "ruc" ? "13 dígitos" : "Número de pasaporte"} aria-label="Número de identificación" />
          {errors.idNumber && <span className="mt-1 block text-xs font-medium text-bad">{errors.idNumber}</span>}
          <span className="mt-1 block text-xs text-muted">La usarás para iniciar sesión.</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Celular" error={errors.phone}><Input type="tel" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" placeholder="09XXXXXXXX" /></Field>
          <Field label="Correo (opcional)" error={errors.email}><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contraseña" error={errors.password}><Input type="password" value={f.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Repite la contraseña" error={errors.password2}><Input type="password" value={f.password2} onChange={(e) => set("password2", e.target.value)} autoComplete="new-password" /></Field>
        </div>
        {!dist?.valid && (
          <Field label="Código de distribuidor (opcional)" hint="Si te invitó un distribuidor, escribe su código (D-XXXXX).">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="D-XXXXX" />
          </Field>
        )}
        <label className="flex items-start gap-2.5 text-sm text-ink-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={f.acceptTerms} onChange={(e) => set("acceptTerms", e.target.checked)} />
          <span>Acepto los términos del programa y el tratamiento de mis datos personales conforme a la Ley Orgánica de Protección de Datos Personales del Ecuador.</span>
        </label>
        {errors.acceptTerms && <span className="-mt-2 block text-xs font-medium text-bad">{errors.acceptTerms}</span>}
        {err && <Alert tone="bad">{err}</Alert>}
        <Button type="submit" size="lg" block loading={busy}>Crear mi cuenta</Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">¿Ya tienes cuenta? <Link to="/ingresar" className="font-bold text-brand-700 hover:underline">Ingresar</Link></p>
    </AuthLayout>
  );
}
