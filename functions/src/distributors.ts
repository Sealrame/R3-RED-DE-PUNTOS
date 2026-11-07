import { onCall } from "firebase-functions/v2/https";
import {
  COL, EMAIL_RE, FieldValue, audit, auth, bumpStats, db, fail, generateUniqueCode, mapAuthError, registryRef, requireRole, str,
} from "./lib/core";
import { normalizeEcPhone, searchKey, isValidRuc } from "./shared/domain";
import { callableOpts } from "./lib/options";

function distributorFields(d: Record<string, unknown>) {
  const name = str(d.name, "Nombre comercial", { min: 2, max: 120 });
  const ruc = str(d.ruc, "RUC", { optional: true, max: 13 });
  if (ruc && !isValidRuc(ruc)) fail("invalid-argument", "RUC inválido.");
  const phoneRaw = str(d.phone, "Teléfono", { optional: true, max: 20 });
  const phone = phoneRaw ? normalizeEcPhone(phoneRaw) : null;
  if (phoneRaw && !phone) fail("invalid-argument", "Teléfono inválido.");
  return {
    name,
    searchName: searchKey(name),
    ruc: ruc || null,
    contactName: str(d.contactName, "Contacto", { optional: true, max: 120 }) || null,
    phone,
    city: str(d.city, "Ciudad", { optional: true, max: 80 }) || null,
    province: str(d.province, "Provincia", { optional: true, max: 80 }) || null,
    address: str(d.address, "Dirección", { optional: true, max: 200 }) || null,
  };
}

/** Admin crea un distribuidor y su cuenta de acceso (correo + contraseña). */
export const createDistributor = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "admin");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const fields = distributorFields(d);
  const email = str(d.email, "Correo de acceso", { max: 120 }).toLowerCase();
  if (!EMAIL_RE.test(email)) fail("invalid-argument", "Correo inválido.");
  const password = typeof d.password === "string" ? d.password : "";
  if (password.length < 8) fail("invalid-argument", "La contraseña debe tener al menos 8 caracteres.");

  const ref = db.collection(COL.distributors).doc();
  let uid: string;
  try {
    uid = (await auth.createUser({ email, password, displayName: fields.name })).uid;
  } catch (e) {
    mapAuthError(e);
  }
  try {
    const out = await db.runTransaction(async (tx) => {
      const registrationCode = await generateUniqueCode(tx, "D", 5);
      const now = FieldValue.serverTimestamp();
      tx.set(ref, {
        ...fields, email, ownerUid: uid, registrationCode, status: "active",
        affiliateCount: 0, purchaseCount: 0, pointsGenerated: 0, salesCents: 0, reversalCount: 0,
        lastPurchaseAt: null, createdAt: now, updatedAt: now, createdBy: actor.uid,
      });
      tx.set(db.doc(`${COL.users}/${uid}`), {
        role: "distributor", distributorId: ref.id, displayName: fields.name, email, status: "active", createdAt: now,
      });
      tx.set(registryRef(`code:${registrationCode}`), { type: "distributor", distributorId: ref.id });
      bumpStats(tx, { distributorsTotal: 1, distributorsActive: 1 });
      audit(tx, actor, "distributor.create", { type: "distributor", id: ref.id }, { name: fields.name, email });
      return { distributorId: ref.id, registrationCode };
    });
    await auth.setCustomUserClaims(uid, { role: "distributor", distributorId: ref.id });
    return out;
  } catch (e) {
    await auth.deleteUser(uid).catch(() => undefined);
    throw e;
  }
});

/** Admin edita datos del distribuidor (incluye el correo de acceso). */
export const updateDistributor = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "admin");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const id = str(d.id, "id", { max: 60 });
  const fields = distributorFields(d);
  const email = str(d.email, "Correo de acceso", { max: 120 }).toLowerCase();
  if (!EMAIL_RE.test(email)) fail("invalid-argument", "Correo inválido.");
  const ref = db.doc(`${COL.distributors}/${id}`);
  const snap = await ref.get();
  if (!snap.exists) fail("not-found", "Distribuidor no encontrado.");
  const before = snap.data()!;
  if (before.email !== email) {
    try {
      await auth.updateUser(before.ownerUid, { email });
    } catch (e) {
      mapAuthError(e);
    }
  }
  await db.runTransaction(async (tx) => {
    tx.update(ref, { ...fields, email, updatedAt: FieldValue.serverTimestamp() });
    tx.update(db.doc(`${COL.users}/${before.ownerUid}`), { displayName: fields.name, email });
    const changed = Object.fromEntries(
      Object.entries({ ...fields, email }).filter(([k, v]) => before[k] !== v && k !== "searchName").map(([k, v]) => [k, { from: before[k] ?? null, to: v }]),
    );
    audit(tx, actor, "distributor.update", { type: "distributor", id }, { changed });
  });
  return { ok: true };
});

/** Activa / desactiva distribuidores o afiliados. Desactivar bloquea el inicio de sesión y revoca sesiones. */
export const setAccountStatus = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "admin");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const targetType = d.targetType;
  if (targetType !== "distributor" && targetType !== "affiliate") fail("invalid-argument", "Tipo inválido.");
  const id = str(d.id, "id", { max: 60 });
  const status = d.status;
  if (status !== "active" && status !== "inactive") fail("invalid-argument", "Estado inválido.");
  const reason = str(d.reason, "Motivo", { min: 5, max: 500 });
  const ref = db.doc(`${targetType === "distributor" ? COL.distributors : COL.affiliates}/${id}`);
  const uid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "Cuenta no encontrada.");
    const prev = snap.get("status");
    const uid = (targetType === "distributor" ? snap.get("ownerUid") : snap.get("uid")) as string;
    if (prev === status) return uid;
    tx.update(ref, { status, statusReason: reason, updatedAt: FieldValue.serverTimestamp() });
    tx.update(db.doc(`${COL.users}/${uid}`), { status });
    if (targetType === "distributor") bumpStats(tx, { distributorsActive: status === "active" ? 1 : -1 });
    audit(tx, actor, `${targetType}.status`, { type: targetType, id }, { from: prev, to: status, reason });
    return uid;
  });
  await auth.updateUser(uid, { disabled: status === "inactive" });
  if (status === "inactive") await auth.revokeRefreshTokens(uid);
  return { ok: true };
});

/** Admin restablece la contraseña de un distribuidor o afiliado. */
export const resetUserPassword = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "admin");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const targetType = d.targetType;
  if (targetType !== "distributor" && targetType !== "affiliate") fail("invalid-argument", "Tipo inválido.");
  const id = str(d.id, "id", { max: 60 });
  const password = typeof d.password === "string" ? d.password : "";
  if (password.length < 8) fail("invalid-argument", "La contraseña debe tener al menos 8 caracteres.");
  const snap = await db.doc(`${targetType === "distributor" ? COL.distributors : COL.affiliates}/${id}`).get();
  if (!snap.exists) fail("not-found", "Cuenta no encontrada.");
  const uid = (targetType === "distributor" ? snap.get("ownerUid") : snap.get("uid")) as string;
  await auth.updateUser(uid, { password });
  await auth.revokeRefreshTokens(uid);
  await db.runTransaction(async (tx) => {
    audit(tx, actor, `${targetType}.resetPassword`, { type: targetType, id }, {});
  });
  return { ok: true };
});
