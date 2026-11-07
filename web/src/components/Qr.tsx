import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import QrScannerLib from "qr-scanner";
import { Camera, CameraOff, Download, Share2 } from "lucide-react";
import { Button, cx } from "./ui";
import { BRAND } from "@/lib/firebase";

/** Dibuja un QR en canvas (alta corrección de errores para pantallas con brillo bajo o rayadas). */
export function QrImage({ value, size = 240, className }: { value: string; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, value, { width: size, margin: 1, errorCorrectionLevel: "Q", color: { dark: "#0c1a14", light: "#ffffff" } });
  }, [value, size]);
  return <canvas ref={ref} className={cx("rounded-xl", className)} style={{ width: size, height: size }} aria-label="Código QR" role="img" />;
}

/** Genera una imagen PNG "tarjeta" con el QR, título y subtítulo, lista para guardar en el celular o imprimir. */
export async function qrCardPng(value: string, title: string, subtitle: string): Promise<Blob> {
  const W = 900, H = 1200;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#10261d"); grad.addColorStop(1, "#08120e");
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = "#d8b45a"; g.font = "800 44px 'Manrope Variable', sans-serif"; g.textAlign = "center";
  g.fillText(BRAND, W / 2, 120);
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, value, { width: 620, margin: 2, errorCorrectionLevel: "Q", color: { dark: "#0c1a14", light: "#ffffff" } });
  g.fillStyle = "#fff";
  roundRect(g, (W - 680) / 2, 190, 680, 680, 40); g.fill();
  g.drawImage(qr, (W - 620) / 2, 220);
  g.fillStyle = "#ffffff"; g.font = "800 48px 'Manrope Variable', sans-serif";
  g.fillText(title, W / 2, 970, W - 80);
  g.fillStyle = "rgba(255,255,255,.7)"; g.font = "600 36px 'Manrope Variable', sans-serif";
  g.fillText(subtitle, W / 2, 1030, W - 80);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export function QrActions({ value, title, subtitle, filename }: { value: string; title: string; subtitle: string; filename: string }) {
  const [busy, setBusy] = useState(false);
  const canShare = typeof navigator !== "undefined" && "canShare" in navigator;
  const download = async () => {
    setBusy(true);
    try {
      const blob = await qrCardPng(value, title, subtitle);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } finally { setBusy(false); }
  };
  const share = async () => {
    const blob = await qrCardPng(value, title, subtitle);
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title }).catch(() => undefined);
    else await download();
  };
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Button variant="secondary" onClick={download} loading={busy}><Download className="size-4" /> Descargar</Button>
      {canShare && <Button variant="secondary" onClick={share}><Share2 className="size-4" /> Compartir</Button>}
    </div>
  );
}

/** Escáner de QR con la cámara trasera. Llama onResult una sola vez por lectura. */
export function QrScanner({ onResult, paused }: { onResult: (text: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScannerLib | null>(null);
  const cb = useRef(onResult);
  cb.current = onResult;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!video.current) return;
    const el = video.current;
    let s: QrScannerLib | null = null;
    // Se crea en el siguiente tick: en StrictMode el montaje de prueba se cancela antes de abrir la cámara.
    const t = setTimeout(() => {
      s = new QrScannerLib(el, (r) => cb.current(r.data), {
        preferredCamera: "environment", highlightScanRegion: false, highlightCodeOutline: false, maxScansPerSecond: 8, returnDetailedScanResult: true,
        // Analiza el cuadro completo (reducido a máx. 800px): lee el QR aunque esté muy cerca de la cámara.
        calculateScanRegion: (v) => {
          const scale = Math.min(1, 800 / Math.max(v.videoWidth, v.videoHeight));
          return { x: 0, y: 0, width: v.videoWidth, height: v.videoHeight, downScaledWidth: Math.round(v.videoWidth * scale), downScaledHeight: Math.round(v.videoHeight * scale) };
        },
      });
      scanner.current = s;
      s.start().catch((e) => {
        setError(String(e).includes("NotAllowed") || String(e).includes("ermission")
          ? "Permite el acceso a la cámara para escanear el QR."
          : "No se encontró una cámara disponible. Ingresa el código manualmente.");
      });
    }, 0);
    return () => { clearTimeout(t); s?.destroy(); scanner.current = null; };
  }, []);

  // Pausa/reanuda solo ante cambios reales (evita dos start() simultáneos que dejan el video sin stream)
  const wasPaused = useRef(false);
  useEffect(() => {
    const s = scanner.current;
    if (!s || error) return;
    if (paused && !wasPaused.current) { s.pause(); wasPaused.current = true; }
    else if (!paused && wasPaused.current) { wasPaused.current = false; s.start().catch(() => undefined); }
  }, [paused, error]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-black">
      <video ref={video} className="size-full object-cover" muted playsInline />
      {!error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="relative size-[62%]">
            {["left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl", "right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl", "left-0 bottom-0 border-l-4 border-b-4 rounded-bl-2xl", "right-0 bottom-0 border-r-4 border-b-4 rounded-br-2xl"].map((c) => (
              <span key={c} className={cx("absolute size-10 border-[#3ddc97]", c)} />
            ))}
            <span className="absolute inset-x-3 top-1/2 h-0.5 animate-pulse bg-[#3ddc97]/80 shadow-[0_0_12px_#3ddc97]" />
          </div>
          <p className="absolute bottom-4 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur"><Camera className="size-3.5" /> Apunta al QR del socio</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
          <div><CameraOff className="mx-auto mb-2 size-8 text-white/60" /><p className="text-sm font-medium">{error}</p></div>
        </div>
      )}
    </div>
  );
}
