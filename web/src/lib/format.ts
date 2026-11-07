import type { Timestamp } from "firebase/firestore";
export { formatUsd, formatPoints } from "@shared/domain";

const dtf = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" });
const df = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeZone: "America/Guayaquil" });

export function toDate(t: Timestamp | Date | null | undefined): Date | null {
  if (!t) return null;
  return t instanceof Date ? t : t.toDate();
}
export const fmtDateTime = (t: Timestamp | Date | null | undefined) => { const d = toDate(t); return d ? dtf.format(d) : "—"; };
export const fmtDate = (t: Timestamp | Date | null | undefined) => { const d = toDate(t); return d ? df.format(d) : "—"; };

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat("es-EC", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
}

export function lastMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date(Date.now() - 5 * 3600e3);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Inicio del día en Ecuador para un input type=date (YYYY-MM-DD). */
export function ecDayStart(ymd: string) { return new Date(`${ymd}T00:00:00-05:00`); }
export function ecDayEnd(ymd: string) { return new Date(`${ymd}T23:59:59.999-05:00`); }
