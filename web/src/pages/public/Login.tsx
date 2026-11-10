import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { Eye, EyeOff } from "lucide-react";
import { HOME, useSession } from "@/auth/AuthProvider";
import { auth } from "@/lib/firebase";
import { errorMessage } from "@/lib/api";
import { Alert, Button, Field, Input, PageLoader, Sheet } from "@/components/ui";
import { AuthLayout } from "./AuthLayout";
import { InstallApp } from "@/components/InstallApp";

export default function Login() {
  const s = useSession();
  const nav = useNavigate();
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  if (s.loading) return <PageLoader />;
  if (s.user && s.role) return <Navigate to={HOME[s.role]} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const role = await s.login(id, pw);
      if (!role) { setErr("Tu cuenta no tiene un rol asignado. Contacta al administrador."); return; }
      nav(HOME[role], { replace: true });
    } catch (e) {
      setErr(errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      <h1 className="title-display text-[40px]">Ingresar</h1>
      <p className="mt-1 text-sm text-muted">Socios: usa tu número de cédula o pasaporte. Distribuidores y administración: tu correo.</p>
      <form onSubmit={submit} className="mt-7 space-y-4">
        <Field label="Cédula, pasaporte o correo">
          <Input autoComplete="username" inputMode="text" value={id} onChange={(e) => setId(e.target.value)} placeholder="Ej. 1710034065" required autoFocus />
        </Field>
        <Field label="Contraseña">
          <div className="relative">
            <Input type={show ? "text" : "password"} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required className="pr-11" />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-1 top-1 grid size-9 place-items-center text-muted" aria-label={show ? "Ocultar" : "Mostrar"}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        {err && <Alert tone="bad">{err}</Alert>}
        <Button type="submit" size="lg" block loading={busy}>Ingresar</Button>
      </form>
      <div className="mt-5 flex items-center justify-between text-sm">
        <button onClick={() => setForgot(true)} className="font-semibold text-ink-2 hover:underline">¿Olvidaste tu contraseña?</button>
        <Link to="/registro" className="font-bold text-brand-700 hover:underline">Crear cuenta de socio</Link>
      </div>
      <InstallApp className="mt-8" />
      <ForgotSheet open={forgot} onClose={() => setForgot(false)} />
    </AuthLayout>
  );
}

function ForgotSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | string>("idle");
  return (
    <Sheet open={open} onClose={onClose} title="Recuperar contraseña">
      <div className="space-y-4">
        <Alert>Si eres <b>socio</b>, pide a tu distribuidor o al administrador que restablezca tu contraseña (por seguridad se verifica tu identidad).</Alert>
        <p className="text-sm text-ink-2">Distribuidores y administración: te enviaremos un enlace a tu correo.</p>
        <Input type="email" placeholder="correo@empresa.ec" value={email} onChange={(e) => setEmail(e.target.value)} />
        {state === "sent" ? <Alert tone="ok">Si el correo está registrado, recibirás un enlace en unos minutos.</Alert>
          : state !== "idle" && state !== "busy" ? <Alert tone="bad">{state}</Alert> : null}
        <Button block loading={state === "busy"} disabled={!email.includes("@")} onClick={async () => {
          setState("busy");
          try { await sendPasswordResetEmail(auth, email.trim()); setState("sent"); } catch (e) {
            setState((e as { code?: string }).code === "auth/user-not-found" ? "sent" : errorMessage(e));
          }
        }}>Enviar enlace</Button>
      </div>
    </Sheet>
  );
}
