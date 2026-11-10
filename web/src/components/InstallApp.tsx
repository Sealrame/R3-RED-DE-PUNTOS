import { useEffect, useState } from "react";
import { Download, PlusSquare, Share } from "lucide-react";
import { Button, Sheet } from "./ui";
import { isNativeApp } from "@/lib/native";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: PromptEvent | null = null;
if (typeof window !== "undefined")
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as PromptEvent; });

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Botón "Instalar app": Android/Chrome usa el diálogo nativo; iPhone muestra cómo agregarla a la pantalla de inicio. */
export function InstallApp({ className }: { className?: string }) {
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const onPrompt = () => setTimeout(() => setCanPrompt(!!deferred));
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  if (isNativeApp || installed || (!canPrompt && !isIos())) return null;
  return (
    <>
      <Button variant="secondary" block className={className} onClick={async () => {
        if (deferred) { await deferred.prompt(); const r = await deferred.userChoice; if (r.outcome === "accepted") setInstalled(true); deferred = null; setCanPrompt(false); }
        else setHelp(true);
      }}><Download className="size-4" /> Instalar app en este teléfono</Button>
      <Sheet open={help} onClose={() => setHelp(false)} title="Instalar en iPhone">
        <ol className="space-y-4 text-[15px]">
          <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-500 font-bold">1</span><span>Abre este enlace en <b>Safari</b>.</span></li>
          <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-500 font-bold">2</span><span>Toca el botón <b>Compartir</b> <Share className="inline size-4 align-text-bottom" /> en la barra inferior.</span></li>
          <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-500 font-bold">3</span><span>Elige <b>Agregar a inicio</b> <PlusSquare className="inline size-4 align-text-bottom" /> y luego <b>Agregar</b>.</span></li>
        </ol>
        <p className="mt-5 text-sm text-muted">Aparecerá el ícono de R3 en tu pantalla de inicio y se abrirá como una app.</p>
      </Sheet>
    </>
  );
}
