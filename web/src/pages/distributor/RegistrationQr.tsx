import { Copy } from "lucide-react";
import { Button, Card, PageHeader, PageLoader, useToast } from "@/components/ui";
import { QrActions, QrImage } from "@/components/Qr";
import { useMyDistributor } from "./data";

export function registrationUrl(code?: string) {
  return `${location.origin}/registro${code ? `?d=${code}` : ""}`;
}

export default function RegistrationQr() {
  const d = useMyDistributor();
  const toast = useToast();
  if (d.loading || !d.data) return <PageLoader />;
  const url = registrationUrl(d.data.registrationCode);
  return (
    <div className="mx-auto max-w-sm text-center">
      <PageHeader title="QR de registro" subtitle="Los socios que se registren con este QR quedan vinculados a tu distribuidor." />
      <Card className="p-6">
        <div className="mx-auto w-fit rounded-2xl bg-white p-3 ring-1 ring-line"><QrImage value={url} size={240} /></div>
        <p className="mt-4 font-extrabold">{d.data.name}</p>
        <p className="tabular text-sm font-bold tracking-[0.2em] text-ink-2">{d.data.registrationCode}</p>
      </Card>
      <div className="mt-4 space-y-3">
        <QrActions value={url} title="Únete y acumula puntos" subtitle={d.data.name} filename={`qr-registro-${d.data.registrationCode}.png`} />
        <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(url).then(() => toast("Enlace copiado"))}><Copy className="size-4" /> Copiar enlace</Button>
      </div>
    </div>
  );
}
