import { onCall } from "firebase-functions/v2/https";
import { COL, FieldValue, audit, bumpStats, db, fail, idempotencyKey, int, randomCode, requireRole, str } from "./lib/core";
import { RedemptionStatus } from "./shared/domain";
import { callableOpts } from "./lib/options";

/** Admin crea o edita una recompensa. La imagen se sube a Storage desde el panel y aquí llega su URL. */
export const saveReward = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "admin");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const id = str(d.id, "id", { optional: true, max: 60 });
  const data = {
    name: str(d.name, "Nombre", { min: 2, max: 80 }),
    description: str(d.description, "Descripción", { optional: true, max: 500 }),
    pointsCost: int(d.pointsCost, "Puntos necesarios", { min: 1, max: 10_000_000 }),
    imageUrl: str(d.imageUrl, "Imagen", { optional: true, max: 1000 }) || null,
    imagePath: str(d.imagePath, "Ruta imagen", { optional: true, max: 300 }) || null,
    stock: d.stock === null || d.stock === undefined || d.stock === "" ? null : int(d.stock, "Disponibilidad", { min: 0, max: 1_000_000 }),
    category: str(d.category, "Categoría", { optional: true, max: 40 }) || null,
    active: d.active === true,
    sortOrder: typeof d.sortOrder === "number" ? Math.trunc(d.sortOrder) : 0,
  };
  if (data.imageUrl && !/^https?:\/\//.test(data.imageUrl)) fail("invalid-argument", "URL de imagen inválida.");
  const ref = id ? db.doc(`${COL.rewards}/${id}`) : db.collection(COL.rewards).doc();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (id && !snap.exists) fail("not-found", "Recompensa no encontrada.");
    const now = FieldValue.serverTimestamp();
    tx.set(ref, { ...data, updatedAt: now, ...(snap.exists ? {} : { createdAt: now, redeemedCount: 0 }) }, { merge: true });
    audit(tx, actor, id ? "reward.update" : "reward.create", { type: "reward", id: ref.id }, { before: snap.data() ?? null, after: data });
  });
  return { id: ref.id };
});

/**
 * El afiliado solicita un canje. Los puntos quedan RESERVADOS (no disponibles) hasta que el admin apruebe o rechace,
 * así no se puede solicitar más de lo que se tiene ni descontar dos veces.
 */
export const requestRedemption = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "affiliate");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const rewardId = str(d.rewardId, "Recompensa", { max: 60 });
  const key = idempotencyKey(d.idempotencyKey);
  const affiliateId = actor.affiliateId!;
  const ref = db.doc(`${COL.redemptions}/red_${affiliateId}_${key}`);
  const rewardRef = db.doc(`${COL.rewards}/${rewardId}`);
  const walletRef = db.doc(`${COL.wallets}/${affiliateId}`);
  const affRef = db.doc(`${COL.affiliates}/${affiliateId}`);
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return { redemptionId: ref.id, replayed: true };
    const [reward, wallet, aff] = await Promise.all([tx.get(rewardRef), tx.get(walletRef), tx.get(affRef)]);
    if (!aff.exists || aff.get("status") !== "active") fail("failed-precondition", "Tu cuenta no está activa.");
    if (!reward.exists || reward.get("active") !== true) fail("not-found", "La recompensa no está disponible.");
    const stock = reward.get("stock") as number | null;
    if (stock !== null && stock <= 0) fail("failed-precondition", "Recompensa agotada.");
    const cost = reward.get("pointsCost") as number;
    const available = wallet.get("balance") - (wallet.get("reserved") ?? 0);
    if (available < cost) fail("failed-precondition", `Puntos insuficientes. Disponibles: ${available}, necesarios: ${cost}.`);
    const now = FieldValue.serverTimestamp();
    tx.set(ref, {
      affiliateId, affiliateUid: actor.uid, affiliateName: aff.get("fullName"), affiliateCode: aff.get("code"),
      rewardId, rewardName: reward.get("name"), rewardImageUrl: reward.get("imageUrl") ?? null, pointsCost: cost,
      status: "pending" satisfies RedemptionStatus, code: null, requestedAt: now, updatedAt: now, history: [],
    });
    tx.update(walletRef, { reserved: FieldValue.increment(cost), updatedAt: now });
    if (stock !== null) tx.update(rewardRef, { stock: FieldValue.increment(-1) });
    bumpStats(tx, { redemptionsPending: 1 });
    audit(tx, actor, "redemption.request", { type: "redemption", id: ref.id }, { rewardId, cost });
    return { redemptionId: ref.id, replayed: false };
  });
});

/** El afiliado cancela su solicitud mientras está pendiente: se liberan los puntos reservados. */
export const cancelRedemption = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "affiliate");
  const id = str((req.data as { redemptionId?: unknown })?.redemptionId, "Canje", { max: 160 });
  const ref = db.doc(`${COL.redemptions}/${id}`);
  await db.runTransaction(async (tx) => {
    const r = await tx.get(ref);
    if (!r.exists || r.get("affiliateId") !== actor.affiliateId) fail("not-found", "Canje no encontrado.");
    if (r.get("status") !== "pending") fail("failed-precondition", "Solo puedes cancelar canjes pendientes.");
    const reward = await tx.get(db.doc(`${COL.rewards}/${r.get("rewardId")}`));
    release(tx, r, reward);
    tx.update(ref, { status: "cancelled", updatedAt: FieldValue.serverTimestamp(), resolvedBy: actor.uid });
    bumpStats(tx, { redemptionsPending: -1 });
    audit(tx, actor, "redemption.cancel", { type: "redemption", id }, {});
  });
  return { ok: true };
});

function release(tx: FirebaseFirestore.Transaction, r: FirebaseFirestore.DocumentSnapshot, reward: FirebaseFirestore.DocumentSnapshot) {
  tx.update(db.doc(`${COL.wallets}/${r.get("affiliateId")}`), {
    reserved: FieldValue.increment(-(r.get("pointsCost") as number)), updatedAt: FieldValue.serverTimestamp(),
  });
  if (reward.exists && reward.get("stock") !== null) tx.update(reward.ref, { stock: FieldValue.increment(1) });
}

/**
 * Admin resuelve un canje:
 *  approve: pending → approved. Descuenta puntos (una sola vez, transición verificada), genera código y movimiento.
 *  reject:  pending → rejected. Libera la reserva.
 *  deliver: approved → delivered. Marca la entrega del premio.
 */
export const resolveRedemption = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "admin");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const id = str(d.redemptionId, "Canje", { max: 160 });
  const action = d.action;
  if (action !== "approve" && action !== "reject" && action !== "deliver") fail("invalid-argument", "Acción inválida.");
  const note = str(d.note, "Nota", { optional: true, max: 500 }) || null;
  if (action === "reject" && !note) fail("invalid-argument", "Indica el motivo del rechazo.");
  const ref = db.doc(`${COL.redemptions}/${id}`);
  return db.runTransaction(async (tx) => {
    const r = await tx.get(ref);
    if (!r.exists) fail("not-found", "Canje no encontrado.");
    const status = r.get("status") as RedemptionStatus;
    const now = FieldValue.serverTimestamp();
    const hist = { action, by: actor.uid, note, at: new Date().toISOString() };

    if (action === "deliver") {
      if (status !== "approved") fail("failed-precondition", "Solo se pueden entregar canjes aprobados.");
      tx.update(ref, { status: "delivered", deliveredBy: actor.uid, deliveredAt: now, updatedAt: now, history: FieldValue.arrayUnion(hist) });
      audit(tx, actor, "redemption.deliver", { type: "redemption", id }, { note });
      return { status: "delivered" };
    }
    if (status !== "pending") fail("failed-precondition", `El canje ya fue procesado (${status}).`);
    const reward = await tx.get(db.doc(`${COL.rewards}/${r.get("rewardId")}`));
    const walletRef = db.doc(`${COL.wallets}/${r.get("affiliateId")}`);
    const wallet = await tx.get(walletRef);

    if (action === "reject") {
      release(tx, r, reward);
      tx.update(ref, { status: "rejected", resolvedBy: actor.uid, resolvedAt: now, note, updatedAt: now, history: FieldValue.arrayUnion(hist) });
      bumpStats(tx, { redemptionsPending: -1 });
      audit(tx, actor, "redemption.reject", { type: "redemption", id }, { note });
      return { status: "rejected" };
    }

    const cost = r.get("pointsCost") as number;
    if ((wallet.get("balance") as number) < cost) fail("failed-precondition", "El afiliado ya no tiene saldo suficiente.");
    const code = `CJ-${randomCode(8)}`;
    const txRef = db.doc(`${COL.transactions}/rdm_${id}`);
    tx.set(txRef, {
      type: "redemption", status: "confirmed", affiliateId: r.get("affiliateId"), affiliateUid: r.get("affiliateUid"),
      affiliateName: r.get("affiliateName"), affiliateCode: r.get("affiliateCode"), distributorId: null, distributorName: null,
      amountCents: 0, points: -cost, balanceAfter: wallet.get("balance") - cost, redemptionId: id, rewardName: r.get("rewardName"),
      redemptionCode: code, flags: [], createdBy: actor.uid, createdByRole: "admin", createdAt: now,
    });
    tx.update(walletRef, {
      balance: FieldValue.increment(-cost), reserved: FieldValue.increment(-cost), totalRedeemed: FieldValue.increment(cost), updatedAt: now,
    });
    tx.update(ref, {
      status: "approved", code, approvedBy: actor.uid, approvedAt: now, transactionId: txRef.id, note, updatedAt: now,
      history: FieldValue.arrayUnion(hist),
    });
    if (reward.exists) tx.update(reward.ref, { redeemedCount: FieldValue.increment(1) });
    bumpStats(tx, { redemptionsPending: -1, redemptions: 1, pointsRedeemed: cost, pointsInCirculation: -cost }, { monthly: { pointsRedeemed: cost, redemptions: 1 } });
    audit(tx, actor, "redemption.approve", { type: "redemption", id }, { code, cost });
    return { status: "approved", code };
  });
});
