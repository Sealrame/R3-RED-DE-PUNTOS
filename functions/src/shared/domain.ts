/**
 * Lógica de dominio compartida entre backend (Cloud Functions) y frontend.
 * El backend es SIEMPRE la autoridad: el frontend usa estas funciones solo
 * para mostrar estimaciones antes de confirmar.
 */

export type Role = "admin" | "distributor" | "affiliate";
export type AccountStatus = "active" | "inactive";
export type TxType = "purchase" | "redemption" | "adjustment" | "reversal";
export type TxStatus = "confirmed" | "reversed";
export type RedemptionStatus = "pending" | "approved" | "delivered" | "rejected" | "cancelled";
export type Rounding = "floor" | "round" | "ceil";
export type IdType = "cedula" | "ruc" | "pasaporte";

export interface PointsConfig {
  /** Puntos otorgados por cada 1 USD de compra. Por defecto 1. */
  pointsPerDollar: number;
  /** Cómo convertir puntos fraccionarios a enteros. Por defecto "floor". */
  rounding: Rounding;
  /** Monto mínimo de compra en centavos. */
  minPurchaseCents: number;
  /** Monto máximo de compra en centavos (protección contra errores de digitación). */
  maxPurchaseCents: number;
  /** Ventana (segundos) para marcar compras idénticas como posible duplicado. */
  duplicateWindowSeconds: number;
  /** Equivalencia informativa: valor en USD de 1 punto al canjear. */
  pointValueUsd: number;
  /** Si es true, el registro de afiliados exige un código de distribuidor. */
  requireDistributorOnSignup: boolean;
}

export const DEFAULT_POINTS_CONFIG: PointsConfig = {
  pointsPerDollar: 1,
  rounding: "floor",
  minPurchaseCents: 100,
  maxPurchaseCents: 1_000_000, // $10.000
  duplicateWindowSeconds: 120,
  pointValueUsd: 0.01,
  requireDistributorOnSignup: false,
};

/** Convierte un texto/numero en USD a centavos enteros de forma exacta (sin errores de coma flotante). */
export function parseAmountToCents(input: string | number): number | null {
  const s = String(input).trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [int, dec = ""] = s.split(".");
  return Number(int) * 100 + Number((dec + "00").slice(0, 2));
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function formatPoints(points: number): string {
  return new Intl.NumberFormat("es-EC", { maximumFractionDigits: 0 }).format(points);
}

/**
 * Calcula los puntos de una compra. Trabaja en enteros:
 * puntos = cents * pointsPerDollar / 100, redondeado según config.
 * $250.50 con 1 punto/USD y floor = 250 puntos.
 */
export function calculatePoints(amountCents: number, cfg: Pick<PointsConfig, "pointsPerDollar" | "rounding">): number {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return 0;
  // pointsPerDollar puede tener hasta 2 decimales: lo escalamos a entero.
  const ppdScaled = Math.round(cfg.pointsPerDollar * 100); // e.g. 1 -> 100
  const numerator = amountCents * ppdScaled; // puntos * 10000
  const denom = 10_000;
  switch (cfg.rounding) {
    case "ceil":
      return Math.ceil(numerator / denom);
    case "round":
      return Math.round(numerator / denom);
    default:
      return Math.floor(numerator / denom);
  }
}

export type AmountValidation = { ok: true } | { ok: false; reason: string };

export function validatePurchaseAmount(amountCents: number, cfg: PointsConfig): AmountValidation {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, reason: "El monto debe ser mayor a cero." };
  if (amountCents < cfg.minPurchaseCents)
    return { ok: false, reason: `El monto mínimo es ${formatUsd(cfg.minPurchaseCents)}.` };
  if (amountCents > cfg.maxPurchaseCents)
    return { ok: false, reason: `El monto máximo por compra es ${formatUsd(cfg.maxPurchaseCents)}.` };
  return { ok: true };
}

/**
 * Valida una cédula ecuatoriana (10 dígitos, provincia 01-24 o 30, módulo 10).
 */
export function isValidCedula(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) return false;
  const province = Number(cedula.slice(0, 2));
  if (!((province >= 1 && province <= 24) || province === 30)) return false;
  const third = Number(cedula[2]);
  if (third >= 6) return false;
  const coefs = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let v = Number(cedula[i]) * coefs[i];
    if (v >= 10) v -= 9;
    sum += v;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(cedula[9]);
}

/** RUC de persona natural = cédula + 001. Para sociedades se valida formato. */
export function isValidRuc(ruc: string): boolean {
  if (!/^\d{13}$/.test(ruc)) return false;
  if (!ruc.endsWith("001") && !/^\d{10}00[1-9]$/.test(ruc)) return false;
  const third = Number(ruc[2]);
  if (third < 6) return isValidCedula(ruc.slice(0, 10));
  return third === 6 || third === 9; // pública / jurídica: formato válido
}

export function validateIdNumber(idType: IdType, idNumber: string): boolean {
  const v = idNumber.trim().toUpperCase();
  if (idType === "cedula") return isValidCedula(v);
  if (idType === "ruc") return isValidRuc(v);
  return /^[A-Z0-9]{5,20}$/.test(v);
}

/** Teléfono ecuatoriano: celular 09XXXXXXXX o fijo 0[2-7]XXXXXXX, o formato +593. */
export function normalizeEcPhone(phone: string): string | null {
  let p = phone.replace(/[\s\-().]/g, "");
  if (p.startsWith("+593")) p = "0" + p.slice(4);
  else if (p.startsWith("593") && p.length >= 11) p = "0" + p.slice(3);
  if (/^09\d{8}$/.test(p) || /^0[2-7]\d{7}$/.test(p)) return p;
  return null;
}

/** Normaliza texto para búsqueda por prefijo (sin tildes, minúsculas). */
export function searchKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Ecuador continental: UTC-5 sin horario de verano. */
export const EC_TZ = "America/Guayaquil";
export function monthKey(date: Date): string {
  const shifted = new Date(date.getTime() - 5 * 3600 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Alfabeto sin caracteres ambiguos (0/O, 1/I/L). */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Prefijo del contenido del QR personal. El QR solo lleva un token opaco, nunca datos personales ni saldo. */
export const QR_PREFIX = "RPA1:";
export function encodeAffiliateQr(qrToken: string): string {
  return QR_PREFIX + qrToken;
}
export function decodeAffiliateQr(content: string): { qrToken?: string; code?: string } | null {
  const c = content.trim();
  if (c.startsWith(QR_PREFIX)) {
    const token = c.slice(QR_PREFIX.length);
    return /^[A-Za-z0-9_-]{20,64}$/.test(token) ? { qrToken: token } : null;
  }
  const m = c.toUpperCase().match(/^AF-?([2-9A-HJKMNP-Z]{7})$/);
  if (m) return { code: `AF-${m[1]}` };
  return null;
}

/** Correo sintético para afiliados que inician sesión con su número de identificación. */
export const AFFILIATE_EMAIL_DOMAIN = "socios.redpuntos.app";
export function affiliateLoginEmail(idNumber: string): string {
  return `${idNumber.trim().toLowerCase()}@${AFFILIATE_EMAIL_DOMAIN}`;
}

export const REDEMPTION_LABEL: Record<RedemptionStatus, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  delivered: "Entregado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
};

export const TX_TYPE_LABEL: Record<TxType, string> = {
  purchase: "Compra",
  redemption: "Canje",
  adjustment: "Ajuste",
  reversal: "Reverso",
};
