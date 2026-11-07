import { createContext, forwardRef, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { BRAND } from "@/lib/firebase";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dark";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700 shadow-sm",
  dark: "bg-brand-900 text-white hover:bg-black shadow-sm",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-paper",
  ghost: "text-ink-2 hover:bg-black/5",
  danger: "bg-bad text-white hover:brightness-95",
};
const SIZES = { sm: "h-9 px-3 text-sm rounded-xl", md: "h-11 px-4 text-[15px] rounded-xl", lg: "h-14 px-6 text-base rounded-2xl" };

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES; loading?: boolean; block?: boolean }>(
  ({ variant = "primary", size = "md", loading, block, className, children, disabled, ...p }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 select-none",
        VARIANTS[variant], SIZES[size], block && "w-full", className,
      )}
      {...p}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  ),
);

const inputBase = "w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 outline-none disabled:bg-paper";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cx(inputBase, "h-11", className)} {...p} />
));
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cx(inputBase, "py-2.5 min-h-24", className)} {...p} />
));
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputBase, "h-11 pr-8 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%237a817c%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-no-repeat bg-[right_0.8rem_center]", className)} {...p}>{children}</select>;
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-bad">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Card({ className, children, dark, ...p }: { className?: string; children: ReactNode; dark?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-[var(--radius-card)] border shadow-[var(--shadow-card)]", dark ? "border-transparent bg-brand-900 text-white" : "border-line bg-surface", className)} {...p}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-bold tracking-tight text-ink">{children}</h2>
      {action}
    </div>
  );
}

type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "gold";
const TONES: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", info: "bg-info-bg text-info",
  neutral: "bg-black/5 text-ink-2", gold: "bg-gold-soft text-[#7a5b10]",
};
export function Badge({ tone = "neutral", children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", TONES[tone])}>{icon}{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [Tone, string]> = {
    active: ["ok", "Activo"], inactive: ["neutral", "Inactivo"], confirmed: ["ok", "Confirmada"], reversed: ["bad", "Revertida"],
    pending: ["warn", "Pendiente"], approved: ["info", "Aprobado"], delivered: ["ok", "Entregado"], rejected: ["bad", "Rechazado"], cancelled: ["neutral", "Cancelado"],
  };
  const [tone, label] = map[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-muted", className)} />;
}
export function PageLoader() {
  return <div className="grid min-h-[40vh] place-items-center"><Spinner className="size-7" /></div>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-paper text-muted">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, icon, accent }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; accent?: boolean }) {
  return (
    <Card dark={accent} className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className={cx("text-[13px] font-semibold", accent ? "text-white/70" : "text-muted")}>{label}</p>
        {icon && <span className={cx("grid size-8 place-items-center rounded-xl", accent ? "bg-white/10 text-gold" : "bg-paper text-ink-2")}>{icon}</span>}
      </div>
      <p className="tabular mt-2 text-2xl font-extrabold tracking-tight sm:text-[28px]">{value}</p>
      {sub && <p className={cx("mt-0.5 text-xs", accent ? "text-white/60" : "text-muted")}>{sub}</p>}
    </Card>
  );
}

/** Logo de la marca: coloca el archivo oficial en web/public/brand/logo.png (fondo transparente). */
export function Logo({ light, compact }: { light?: boolean; compact?: boolean }) {
  const [img, setImg] = useState(true);
  if (img)
    return (
      <img src="/brand/logo.png" alt={BRAND} onError={() => setImg(false)}
        className={cx(compact ? "h-9" : "h-10", "w-auto max-w-44 object-contain", light && "rounded-lg bg-white p-1")} />
    );
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="relative grid size-9 place-items-center rounded-xl bg-brand-900 shadow-sm ring-1 ring-white/10">
        <span className="size-4 rounded-full border-[3px] border-gold" />
        <span className="absolute size-1.5 rounded-full bg-[#3ddc97]" />
      </span>
      {!compact && <span className={cx("text-[17px] font-extrabold tracking-tight", light ? "text-white" : "text-ink")}>{BRAND}</span>}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Modal que se comporta como bottom-sheet en móviles. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-[rise_.2s_ease-out]" onClick={onClose} />
      <div className={cx("relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-surface p-5 pb-safe shadow-2xl animate-rise sm:rounded-3xl sm:p-6", wide ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold tracking-tight">{title}</h3>
          <button onClick={onClose} className="grid size-9 place-items-center rounded-full text-muted hover:bg-black/5" aria-label="Cerrar"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  const Icon = { info: Info, warn: AlertTriangle, bad: XCircle, ok: CheckCircle2 }[tone];
  return (
    <div className={cx("flex gap-2.5 rounded-xl px-3.5 py-3 text-sm", TONES[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl bg-black/5 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold transition", value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Toasts ---------- */
type ToastT = { id: number; tone: "ok" | "bad" | "info"; text: string };
const ToastCtx = createContext<(text: string, tone?: ToastT["tone"]) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastT[]>([]);
  const push = useCallback((text: string, tone: ToastT["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
          {items.map((t) => (
            <div key={t.id} role="status" className={cx("pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-[var(--shadow-float)] animate-rise",
              t.tone === "bad" ? "bg-bad text-white" : t.tone === "info" ? "bg-ink text-white" : "bg-brand-900 text-white")}>
              {t.tone === "bad" ? <XCircle className="size-4" /> : <CheckCircle2 className="size-4 text-[#3ddc97]" />}
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
