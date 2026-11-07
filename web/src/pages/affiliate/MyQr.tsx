import { useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import { Card, PageLoader } from "@/components/ui";
import { QrActions, QrImage } from "@/components/Qr";
import { encodeAffiliateQr } from "@shared/domain";
import { useMyAffiliate } from "./data";

export default function MyQr() {
  const { aff } = useMyAffiliate();
  // Mantiene la pantalla encendida mientras el distribuidor escanea (si el navegador lo permite)
  useEffect(() => {
    let lock: WakeLockSentinel | undefined;
    navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    return () => { lock?.release().catch(() => undefined); };
  }, []);
  if (aff.loading || !aff.data) return <PageLoader />;
  const a = aff.data;
  const value = encodeAffiliateQr(a.qrToken);
  return (
    <div className="mx-auto max-w-sm text-center">
      <h1 className="text-2xl font-extrabold tracking-tight">Mi QR de socio</h1>
      <p className="mt-1 text-sm text-muted">Muéstralo al distribuidor en cada compra.</p>
      <Card className="mt-6 p-6 animate-rise">
        <div className="mx-auto w-fit rounded-2xl bg-white p-3 ring-1 ring-line"><QrImage value={value} size={248} /></div>
        <p className="mt-5 text-lg font-extrabold">{a.fullName}</p>
        <p className="tabular mt-0.5 text-[15px] font-bold tracking-[0.2em] text-ink-2">{a.code}</p>
      </Card>
      <div className="mt-5"><QrActions value={value} title={a.fullName} subtitle={a.code} filename={`mi-qr-${a.code}.png`} /></div>
      <p className="mt-6 flex items-start gap-2 text-left text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" />
        Tu QR solo contiene un identificador seguro. No incluye tu saldo ni tus datos personales. Si no hay cámara, el distribuidor puede escribir tu código.
      </p>
    </div>
  );
}
