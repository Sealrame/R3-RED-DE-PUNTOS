import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { IdType, PointsConfig } from "@shared/domain";

function fn<Req, Res>(name: string) {
  const c = httpsCallable<Req, Res>(functions, name);
  return async (data: Req) => (await c(data)).data;
}

export interface AffiliateLookup { id: string; fullName: string; code: string; status: string; idMasked: string; linkedToYou: boolean; linkedDistributorName?: string | null; idNumber?: string; phone?: string; email?: string | null; distributorName?: string | null; balance?: number }

export const api = {
  registerAffiliate: fn<{ fullName: string; idType: IdType; idNumber: string; phone: string; email?: string; password: string; distributorCode?: string; acceptTerms: boolean }, { affiliateId: string; code: string; loginEmail: string }>("registerAffiliate"),
  resolveRegistrationCode: fn<{ code: string }, { valid: boolean; name?: string; city?: string | null }>("resolveRegistrationCode"),
  lookupAffiliate: fn<{ content: string }, AffiliateLookup>("lookupAffiliate"),
  searchAffiliates: fn<{ q: string }, { results: AffiliateLookup[] }>("searchAffiliates"),
  updateMyProfile: fn<{ phone: string; email?: string }, { ok: true }>("updateMyProfile"),

  createDistributor: fn<Record<string, unknown>, { distributorId: string; registrationCode: string }>("createDistributor"),
  updateDistributor: fn<Record<string, unknown>, { ok: true }>("updateDistributor"),
  setAccountStatus: fn<{ targetType: "distributor" | "affiliate"; id: string; status: "active" | "inactive"; reason: string }, { ok: true }>("setAccountStatus"),
  resetUserPassword: fn<{ targetType: "distributor" | "affiliate"; id: string; password: string }, { ok: true }>("resetUserPassword"),

  registerPurchase: fn<{ affiliateId: string; amountCents: number; idempotencyKey: string; reference?: string; confirmDuplicate?: boolean; distributorId?: string }, { transactionId: string; points: number; balanceAfter: number; replayed: boolean; flags?: string[] }>("registerPurchase"),
  reversePurchase: fn<{ transactionId: string; reason: string }, { reversalId: string }>("reversePurchase"),
  adjustPoints: fn<{ affiliateId: string; delta: number; reason: string; idempotencyKey: string }, { transactionId: string }>("adjustPoints"),
  runIntegrityCheck: fn<{ after?: string | null }, { scanned: number; issues: Array<{ affiliateId: string; balance: number; expectedBalance: number; reserved: number; expectedReserved: number }>; next: string | null }>("runIntegrityCheck"),

  saveReward: fn<Record<string, unknown>, { id: string }>("saveReward"),
  requestRedemption: fn<{ rewardId: string; idempotencyKey: string }, { redemptionId: string }>("requestRedemption"),
  cancelRedemption: fn<{ redemptionId: string }, { ok: true }>("cancelRedemption"),
  resolveRedemption: fn<{ redemptionId: string; action: "approve" | "reject" | "deliver"; note?: string }, { status: string; code?: string }>("resolveRedemption"),

  updatePointsConfig: fn<PointsConfig, { ok: true }>("updatePointsConfig"),
};

const FRIENDLY: Record<string, string> = {
  "functions/unauthenticated": "Tu sesión expiró. Vuelve a iniciar sesión.",
  "functions/permission-denied": "No tienes permisos para esta operación.",
  "functions/unavailable": "Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.",
  "functions/internal": "Ocurrió un error inesperado. Intenta de nuevo.",
  "auth/invalid-credential": "Usuario o contraseña incorrectos.",
  "auth/wrong-password": "Usuario o contraseña incorrectos.",
  "auth/user-not-found": "Usuario o contraseña incorrectos.",
  "auth/user-disabled": "Tu cuenta está desactivada. Contacta al administrador.",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
  "auth/network-request-failed": "Sin conexión. Revisa tu internet.",
  "auth/requires-recent-login": "Por seguridad, vuelve a iniciar sesión e inténtalo otra vez.",
  "permission-denied": "No tienes acceso a esta información.",
};

/** Mensaje legible para el usuario. Los errores de negocio del backend ya vienen en español. */
export function errorMessage(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? "";
  if (code.startsWith("functions/") && !["functions/internal", "functions/unavailable", "functions/unauthenticated"].includes(code) && err.message && !/^(INTERNAL|internal)$/.test(err.message))
    return err.message;
  return FRIENDLY[code] ?? err?.message ?? "Error desconocido.";
}

export function errorReason(e: unknown): string | undefined {
  return (e as { details?: { reason?: string } })?.details?.reason;
}

export const newKey = () => crypto.randomUUID();
