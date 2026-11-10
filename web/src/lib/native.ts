/** Puente con la app Android de R3 (WebView). Fuera de la app, todo es undefined y se usa el navegador. */
interface R3AndroidBridge {
  saveImage(base64: string, name: string): void;
  shareImage(base64: string, name: string, title: string): void;
  saveFile(base64: string, name: string, mime: string): void;
}
export const native: R3AndroidBridge | undefined = (window as unknown as { R3Android?: R3AndroidBridge }).R3Android;
export const isNativeApp = !!native || navigator.userAgent.includes("R3PuntosApp");

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
