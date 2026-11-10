import { native } from "./native";

/** Exporta filas a CSV compatible con Excel (BOM UTF-8 y separador ';' usado en configuración regional es-EC). */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [headers, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  if (native) {
    const r = new FileReader();
    r.onload = () => native!.saveFile(String(r.result).split(",")[1] ?? "", filename, "text/csv");
    r.readAsDataURL(blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
