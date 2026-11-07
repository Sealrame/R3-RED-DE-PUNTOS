import { onCall } from "firebase-functions/v2/https";
import {
  COL, FieldValue, audit, auth, bumpStats, db, fail, generateUniqueCode, getPointsConfig, isRegistryTaken,
  mapAuthError, randomToken, registryRef, requireRole, str, EMAIL_RE,
} from "./lib/core";
import { IdType, affiliateLoginEmail, decodeAffiliateQr, normalizeEcPhone, searchKey, validateIdNumber } from "./shared/domain";
import { callableOpts } from "./lib/options";

const ID_TYPES: IdType[] = ["cedula", "ruc", "pasaporte"];

function maskId(id: string) {
  return id.length <= 4 ? id : `${"•".repeat(id.length - 4)}${id.slice(-4)}`;
}

/**
 * Registro público de afiliados (desde el QR de registro o la página /registro).
 * Crea la cuenta de Auth, el perfil, la billetera de puntos y registra la vinculación al distribuidor.
 */
export const registerAffiliate = onCall(callableOpts, async (req) => {
  const d = (req.data ?? {}) as Record<string, unknown>;
  const fullName = str(d.fullName, "Nombre completo", { min: 3, max: 120 });
  const idType = d.idType as IdType;
  if (!ID_TYPES.includes(idType)) fail("invalid-argument", "Tipo de identificación inválido.");
  const idNumber = str(d.idNumber, "Número de identificación", { min: 5, max: 20 }).toUpperCase();
  if (!validateIdNumber(idType, idNumber)) fail("invalid-argument", "El número de identificación no es válido.");
  const phone = normalizeEcPhone(str(d.phone, "Teléfono", { min: 7, max: 20 }));
  if (!phone) fail("invalid-argument", "Teléfono inválido. Usa el formato 09XXXXXXXX.");
  const email = str(d.email, "Correo", { optional: true, max: 120 }).toLowerCase();
  if (email && !EMAIL_RE.test(email)) fail("invalid-argument", "Correo inválido.");
  const password = typeof d.password === "string" ? d.password : "";
  if (password.length < 8 || password.length > 128) fail("invalid-argument", "La contraseña debe tener al menos 8 caracteres.");
  const distributorCode = str(d.distributorCode, "Código de distribuidor", { optional: true, max: 20 }).toUpperCase();
  if (d.acceptTerms !== true) fail("invalid-argument", "Debes aceptar los términos y la política de privacidad.");

  const cfg = await getPointsConfig();
  let distributor: { id: string; name: string } | null = null;
  if (distributorCode) {
    const q = await db.collection(COL.distributors).where("registrationCode", "==", distributorCode).limit(1).get();
    const doc = q.docs[0];
    if (!doc || doc.get("status") !== "active") fail("not-found", "El código de distribuidor no es válido o está inactivo.");
    distributor = { id: doc.id, name: doc.get("name") };
  } else if (cfg.requireDistributorOnSignup) {
    fail("failed-precondition", "El registro requiere el QR o código de un distribuidor.");
  }

  const idKey = `id:${idType}:${idNumber}`;
  if ((await registryRef(idKey).get()).exists) fail("already-exists", "Ya existe un afiliado con esa identificación.");

  const affRef = db.collection(COL.affiliates).doc();
  let uid: string;
  try {
    const user = await auth.createUser({
      email: affiliateLoginEmail(idNumber),
      password,
      displayName: fullName,
    });
    uid = user.uid;
  } catch (e) {
    mapAuthError(e);
  }

  try {
    const result = await db.runTransaction(async (tx) => {
      if (await isRegistryTaken(tx, idKey)) fail("already-exists", "Ya existe un afiliado con esa identificación.");
      const code = await generateUniqueCode(tx, "AF", 7);
      const now = FieldValue.serverTimestamp();
      const qrToken = randomToken();
      tx.set(affRef, {
        uid, fullName, searchName: searchKey(fullName), idType, idNumber, phone, email: email || null,
        code, qrToken, distributorId: distributor?.id ?? null, distributorName: distributor?.name ?? null,
        status: "active", createdAt: now, updatedAt: now,
      });
      tx.set(db.doc(`${COL.wallets}/${affRef.id}`), {
        affiliateId: affRef.id, affiliateUid: uid, balance: 0, reserved: 0,
        totalEarned: 0, totalRedeemed: 0, totalAdjusted: 0, lastPurchase: null, updatedAt: now,
      });
      tx.set(db.doc(`${COL.users}/${uid}`), {
        role: "affiliate", affiliateId: affRef.id, displayName: fullName, loginId: idNumber,
        email: email || null, status: "active", createdAt: now,
      });
      tx.set(registryRef(idKey), { type: "affiliate", affiliateId: affRef.id });
      tx.set(registryRef(`code:${code}`), { type: "affiliate", affiliateId: affRef.id });
      if (distributor) tx.update(db.doc(`${COL.distributors}/${distributor.id}`), { affiliateCount: FieldValue.increment(1) });
      bumpStats(tx, { affiliates: 1 }, {
        monthly: { newAffiliates: 1 },
        distributorId: distributor?.id,
        distributorMonthly: { newAffiliates: 1 },
      });
      audit(tx, { uid, role: "affiliate" }, "affiliate.register", { type: "affiliate", id: affRef.id }, {
        distributorId: distributor?.id ?? null, idType,
      });
      return { affiliateId: affRef.id, code };
    });
    await auth.setCustomUserClaims(uid, { role: "affiliate", affiliateId: affRef.id });
    return { ...result, loginEmail: affiliateLoginEmail(idNumber) };
  } catch (e) {
    await auth.deleteUser(uid).catch(() => undefined); // rollback de la cuenta de Auth
    throw e;
  }
});

/** Identifica al afiliado a partir del contenido del QR o su código. Solo distribuidores y admin. */
export const lookupAffiliate = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "distributor", "admin");
  const content = str((req.data as { content?: unknown })?.content, "QR o código", { max: 100 });
  const parsed = decodeAffiliateQr(content);
  if (!parsed) fail("invalid-argument", "El QR o código no corresponde a un afiliado de la red.");
  let snap;
  if (parsed.qrToken) {
    const q = await db.collection(COL.affiliates).where("qrToken", "==", parsed.qrToken).limit(1).get();
    snap = q.docs[0];
  } else {
    const reg = await registryRef(`code:${parsed.code}`).get();
    if (reg.exists && reg.get("type") === "affiliate") snap = await db.doc(`${COL.affiliates}/${reg.get("affiliateId")}`).get();
  }
  if (!snap || !snap.exists) fail("not-found", "Afiliado no encontrado.");
  const a = snap.data()!;
  return {
    id: snap.id,
    fullName: a.fullName,
    code: a.code,
    status: a.status,
    idMasked: maskId(a.idNumber),
    linkedDistributorName: a.distributorName ?? null,
    linkedToYou: actor.distributorId ? a.distributorId === actor.distributorId : false,
  };
});

/** Búsqueda de afiliados por código, identificación, teléfono o nombre (prefijo). */
export const searchAffiliates = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "distributor", "admin");
  const raw = str((req.data as { q?: unknown })?.q, "Búsqueda", { min: 2, max: 80 });
  const q = raw.trim();
  const col = db.collection(COL.affiliates);
  let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const asCode = decodeAffiliateQr(q);
  const phone = normalizeEcPhone(q);
  if (asCode?.code) {
    docs = (await col.where("code", "==", asCode.code).limit(5).get()).docs;
  } else if (phone || (/^[0-9A-Z]{5,20}$/i.test(q) && /\d/.test(q))) {
    // Una cédula de Guayas (09…) también parece un celular: se consultan ambos campos.
    const [byId, byPhone] = await Promise.all([
      col.where("idNumber", "==", q.replace(/\s/g, "").toUpperCase()).limit(5).get(),
      phone ? col.where("phone", "==", phone).limit(20).get() : Promise.resolve(null),
    ]);
    const seen = new Set<string>();
    docs = [...byId.docs, ...(byPhone?.docs ?? [])].filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  } else {
    const key = searchKey(q);
    docs = (await col.orderBy("searchName").startAt(key).endAt(key + "").limit(20).get()).docs;
  }

  const isAdmin = actor.role === "admin";
  let wallets: Record<string, number> = {};
  if (isAdmin && docs.length) {
    const ws = await db.getAll(...docs.map((d) => db.doc(`${COL.wallets}/${d.id}`)));
    wallets = Object.fromEntries(ws.map((w) => [w.id, (w.get("balance") as number) ?? 0]));
  }
  return {
    results: docs.map((d) => {
      const a = d.data();
      const base = {
        id: d.id, fullName: a.fullName, code: a.code, status: a.status,
        idMasked: maskId(a.idNumber), linkedToYou: actor.distributorId ? a.distributorId === actor.distributorId : false,
      };
      return isAdmin
        ? { ...base, idNumber: a.idNumber, phone: a.phone, email: a.email, distributorName: a.distributorName, balance: wallets[d.id] ?? 0 }
        : base;
    }),
  };
});

/** El afiliado edita sus datos permitidos (teléfono y correo de contacto). Queda historial en auditoría. */
export const updateMyProfile = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "affiliate");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const phone = normalizeEcPhone(str(d.phone, "Teléfono", { min: 7, max: 20 }));
  if (!phone) fail("invalid-argument", "Teléfono inválido.");
  const email = str(d.email, "Correo", { optional: true, max: 120 }).toLowerCase();
  if (email && !EMAIL_RE.test(email)) fail("invalid-argument", "Correo inválido.");
  const ref = db.doc(`${COL.affiliates}/${actor.affiliateId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "Perfil no encontrado.");
    const before = { phone: snap.get("phone"), email: snap.get("email") };
    const after = { phone, email: email || null };
    tx.update(ref, { ...after, updatedAt: FieldValue.serverTimestamp() });
    tx.update(db.doc(`${COL.users}/${actor.uid}`), { email: email || null });
    audit(tx, actor, "affiliate.updateProfile", { type: "affiliate", id: ref.id }, { before, after });
  });
  return { ok: true };
});
