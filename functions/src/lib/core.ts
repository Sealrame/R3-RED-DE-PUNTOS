import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Transaction, DocumentReference } from "firebase-admin/firestore";
import { HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { randomBytes, randomInt } from "node:crypto";
import { CODE_ALPHABET, DEFAULT_POINTS_CONFIG, PointsConfig, Role, monthKey } from "../shared/domain";

if (!getApps().length) initializeApp();

export const db = getFirestore();
export const auth = getAuth();
export { FieldValue };

export const COL = {
  users: "users",
  distributors: "distributors",
  affiliates: "affiliates",
  wallets: "points_wallets",
  transactions: "transactions",
  rewards: "rewards",
  redemptions: "redemptions",
  audit: "audit_logs",
  registry: "registry",
  config: "config",
  stats: "stats",
  statsMonthly: "stats_monthly",
} as const;

export interface Claims {
  role?: Role;
  distributorId?: string;
  affiliateId?: string;
}

export interface Actor {
  uid: string;
  role: Role;
  distributorId?: string;
  affiliateId?: string;
}

export function fail(code: ConstructorParameters<typeof HttpsError>[0], message: string, details?: unknown): never {
  throw new HttpsError(code, message, details);
}

/** Exige sesión y uno de los roles indicados (leídos de custom claims firmados por el servidor). */
export function requireRole(req: CallableRequest<unknown>, ...roles: Role[]): Actor {
  if (!req.auth) fail("unauthenticated", "Debes iniciar sesión.");
  const t = req.auth.token as Claims;
  if (!t.role || !roles.includes(t.role)) fail("permission-denied", "No tienes permisos para esta operación.");
  return { uid: req.auth.uid, role: t.role, distributorId: t.distributorId, affiliateId: t.affiliateId };
}

export function randomCode(length: number, alphabet = CODE_ALPHABET): string {
  let s = "";
  for (let i = 0; i < length; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

/** Token opaco y no adivinable para el QR personal (192 bits). */
export function randomToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function getPointsConfig(tx?: Transaction): Promise<PointsConfig> {
  const ref = db.doc(`${COL.config}/points`);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return { ...DEFAULT_POINTS_CONFIG, ...(snap.exists ? (snap.data() as Partial<PointsConfig>) : {}) };
}

export function audit(
  tx: Transaction,
  actor: Pick<Actor, "uid" | "role"> | { uid: string; role: "system" | Role },
  action: string,
  target: { type: string; id: string },
  data: Record<string, unknown> = {},
) {
  tx.set(db.collection(COL.audit).doc(), {
    action,
    actorUid: actor.uid,
    actorRole: actor.role,
    targetType: target.type,
    targetId: target.id,
    data,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/** Incrementa contadores globales, mensuales y (opcional) del distribuidor dentro de la misma transacción. */
export function bumpStats(
  tx: Transaction,
  global: Record<string, number>,
  opts: { monthly?: Record<string, number>; distributorId?: string; distributorMonthly?: Record<string, number> } = {},
) {
  const inc = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, FieldValue.increment(v)]));
  const now = FieldValue.serverTimestamp();
  if (Object.keys(global).length) tx.set(db.doc(`${COL.stats}/global`), { ...inc(global), updatedAt: now }, { merge: true });
  const ym = monthKey(new Date());
  if (opts.monthly) tx.set(db.doc(`${COL.statsMonthly}/${ym}`), { ...inc(opts.monthly), month: ym }, { merge: true });
  if (opts.distributorId && opts.distributorMonthly)
    tx.set(
      db.doc(`${COL.distributors}/${opts.distributorId}/monthly/${ym}`),
      { ...inc(opts.distributorMonthly), month: ym },
      { merge: true },
    );
}

/** Reserva un valor único (ej. número de identificación o código) usando la colección registry. */
export async function isRegistryTaken(tx: Transaction, key: string): Promise<boolean> {
  return (await tx.get(db.doc(`${COL.registry}/${encodeKey(key)}`))).exists;
}
export function registryRef(key: string): DocumentReference {
  return db.doc(`${COL.registry}/${encodeKey(key)}`);
}
function encodeKey(key: string) {
  return key.replace(/\//g, "_");
}

export async function generateUniqueCode(tx: Transaction, prefix: string, length: number): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = `${prefix}-${randomCode(length)}`;
    if (!(await isRegistryTaken(tx, `code:${code}`))) return code;
  }
  fail("internal", "No se pudo generar un código único. Intenta de nuevo.");
}

export function str(v: unknown, field: string, { min = 1, max = 200, optional = false } = {}): string {
  if (v === undefined || v === null || v === "") {
    if (optional) return "";
    fail("invalid-argument", `El campo "${field}" es obligatorio.`);
  }
  if (typeof v !== "string") fail("invalid-argument", `El campo "${field}" no es válido.`);
  const s = v.trim();
  if (s.length < min || s.length > max) fail("invalid-argument", `El campo "${field}" debe tener entre ${min} y ${max} caracteres.`);
  return s;
}

export function int(v: unknown, field: string, { min = -Infinity, max = Infinity } = {}): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    fail("invalid-argument", `El campo "${field}" debe ser un número entero válido.`);
  return v;
}

export function idempotencyKey(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9-]{16,64}$/.test(v)) fail("invalid-argument", "Clave de idempotencia inválida.");
  return v;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function mapAuthError(e: unknown): never {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "auth/email-already-exists") fail("already-exists", "Ya existe una cuenta con ese correo o identificación.");
  if (code === "auth/invalid-password") fail("invalid-argument", "La contraseña debe tener al menos 8 caracteres.");
  if (code === "auth/invalid-email") fail("invalid-argument", "Correo inválido.");
  if (e instanceof HttpsError) throw e;
  fail("internal", "Error de autenticación.");
}
