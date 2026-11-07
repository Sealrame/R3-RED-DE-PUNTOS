import { onCall } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import {
  Actor, COL, FieldValue, audit, bumpStats, db, fail, getPointsConfig, idempotencyKey, int, requireRole, str,
} from "./lib/core";
import { calculatePoints, validatePurchaseAmount } from "./shared/domain";
import { callableOpts } from "./lib/options";

/**
 * Registra una compra y acredita los puntos de forma atómica.
 * - El cálculo de puntos se hace aquí (backend), con la configuración vigente.
 * - Idempotente: el ID del documento deriva de (distribuidor, idempotencyKey). Reintentos devuelven la misma operación.
 * - Detecta compras idénticas (mismo afiliado, distribuidor y monto) dentro de la ventana configurada y exige confirmación explícita.
 */
export const registerPurchase = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "distributor", "admin");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const affiliateId = str(d.affiliateId, "Afiliado", { max: 60 });
  const amountCents = int(d.amountCents, "Monto", { min: 1, max: 100_000_000 });
  const key = idempotencyKey(d.idempotencyKey);
  const reference = str(d.reference, "Referencia / factura", { optional: true, max: 60 }) || null;
  const confirmDuplicate = d.confirmDuplicate === true;
  const distributorId = actor.role === "admin" ? str(d.distributorId, "Distribuidor", { max: 60 }) : actor.distributorId!;
  if (!distributorId) fail("permission-denied", "Cuenta de distribuidor sin asignación.");

  const txRef = db.doc(`${COL.transactions}/pur_${distributorId}_${key}`);
  const distRef = db.doc(`${COL.distributors}/${distributorId}`);
  const affRef = db.doc(`${COL.affiliates}/${affiliateId}`);
  const walletRef = db.doc(`${COL.wallets}/${affiliateId}`);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(txRef);
    if (existing.exists) {
      const e = existing.data()!;
      if (e.affiliateId !== affiliateId || e.amountCents !== amountCents)
        fail("already-exists", "Clave de operación reutilizada con datos distintos.");
      return { transactionId: txRef.id, points: e.points, balanceAfter: e.balanceAfter, replayed: true };
    }
    const [cfg, dist, aff, wallet] = await Promise.all([getPointsConfig(tx), tx.get(distRef), tx.get(affRef), tx.get(walletRef)]);
    if (!dist.exists || dist.get("status") !== "active") fail("permission-denied", "El distribuidor no está activo.");
    if (!aff.exists) fail("not-found", "Afiliado no encontrado.");
    if (aff.get("status") !== "active") fail("failed-precondition", "El afiliado está inactivo y no puede acumular puntos.");
    if (!wallet.exists) fail("internal", "Billetera de puntos no encontrada.");

    const v = validatePurchaseAmount(amountCents, cfg);
    if (!v.ok) fail("invalid-argument", v.reason);
    const points = calculatePoints(amountCents, cfg);

    const flags: string[] = [];
    const last = wallet.get("lastPurchase") as { distributorId: string; amountCents: number; at: Timestamp } | null;
    if (
      last && last.distributorId === distributorId && last.amountCents === amountCents &&
      Date.now() - last.at.toMillis() < cfg.duplicateWindowSeconds * 1000
    ) {
      if (!confirmDuplicate)
        fail("failed-precondition", "Posible compra duplicada: ya se registró el mismo monto para este afiliado hace instantes.", {
          reason: "possible-duplicate",
        });
      flags.push("possible_duplicate");
    }

    const balanceAfter = (wallet.get("balance") as number) + points;
    const now = FieldValue.serverTimestamp();
    const linkNow = !aff.get("distributorId");
    tx.set(txRef, {
      type: "purchase", status: "confirmed",
      affiliateId, affiliateUid: aff.get("uid"), affiliateName: aff.get("fullName"), affiliateCode: aff.get("code"),
      distributorId, distributorName: dist.get("name"),
      amountCents, points, balanceAfter, reference, flags,
      rule: { pointsPerDollar: cfg.pointsPerDollar, rounding: cfg.rounding },
      createdBy: actor.uid, createdByRole: actor.role, idempotencyKey: key, createdAt: now,
    });
    tx.update(walletRef, {
      balance: FieldValue.increment(points), totalEarned: FieldValue.increment(points),
      lastPurchase: { distributorId, amountCents, at: Timestamp.now() }, updatedAt: now,
    });
    if (linkNow) tx.update(affRef, { distributorId, distributorName: dist.get("name"), updatedAt: now });
    tx.update(distRef, {
      purchaseCount: FieldValue.increment(1), pointsGenerated: FieldValue.increment(points),
      salesCents: FieldValue.increment(amountCents), lastPurchaseAt: now,
      ...(linkNow ? { affiliateCount: FieldValue.increment(1) } : {}),
    });
    bumpStats(
      tx,
      { purchases: 1, salesCents: amountCents, pointsGenerated: points, pointsInCirculation: points, ...(flags.length ? { flagged: 1 } : {}) },
      {
        monthly: { purchases: 1, salesCents: amountCents, pointsGenerated: points },
        distributorId,
        distributorMonthly: { purchases: 1, salesCents: amountCents, pointsGenerated: points },
      },
    );
    audit(tx, actor, "purchase.register", { type: "transaction", id: txRef.id }, { affiliateId, distributorId, amountCents, points, flags });
    return { transactionId: txRef.id, points, balanceAfter, replayed: false, flags };
  });
});

function signedPointsCheck(available: number, delta: number) {
  if (available + delta < 0) fail("failed-precondition", `Saldo disponible insuficiente (${available} pts).`);
}

/** Admin revierte una compra confirmada (no se elimina: se crea un movimiento de reverso). */
export const reversePurchase = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "admin");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const transactionId = str(d.transactionId, "Transacción", { max: 160 });
  const reason = str(d.reason, "Justificación", { min: 10, max: 500 });
  const ref = db.doc(`${COL.transactions}/${transactionId}`);
  return db.runTransaction(async (tx) => {
    const t = await tx.get(ref);
    if (!t.exists || t.get("type") !== "purchase") fail("not-found", "Compra no encontrada.");
    if (t.get("status") !== "confirmed") fail("failed-precondition", "La compra ya fue revertida.");
    const p = t.data()!;
    const walletRef = db.doc(`${COL.wallets}/${p.affiliateId}`);
    const w = await tx.get(walletRef);
    const available = w.get("balance") - (w.get("reserved") ?? 0);
    signedPointsCheck(available, -p.points);
    const revRef = db.doc(`${COL.transactions}/rev_${transactionId}`);
    const now = FieldValue.serverTimestamp();
    tx.update(ref, { status: "reversed", reversedAt: now, reversedBy: actor.uid, reversalId: revRef.id, reversalReason: reason });
    tx.set(revRef, {
      type: "reversal", status: "confirmed", affiliateId: p.affiliateId, affiliateUid: p.affiliateUid,
      affiliateName: p.affiliateName, affiliateCode: p.affiliateCode, distributorId: p.distributorId, distributorName: p.distributorName,
      amountCents: -p.amountCents, points: -p.points, balanceAfter: w.get("balance") - p.points,
      reason, originalTransactionId: transactionId, flags: [], createdBy: actor.uid, createdByRole: "admin", createdAt: now,
    });
    tx.update(walletRef, { balance: FieldValue.increment(-p.points), totalEarned: FieldValue.increment(-p.points), updatedAt: now });
    tx.update(db.doc(`${COL.distributors}/${p.distributorId}`), {
      purchaseCount: FieldValue.increment(-1), pointsGenerated: FieldValue.increment(-p.points),
      salesCents: FieldValue.increment(-p.amountCents), reversalCount: FieldValue.increment(1),
    });
    bumpStats(tx, {
      purchases: -1, salesCents: -p.amountCents, pointsGenerated: -p.points, pointsInCirculation: -p.points, reversals: 1,
      ...((p.flags ?? []).length ? { flagged: -1 } : {}),
    });
    audit(tx, actor, "purchase.reverse", { type: "transaction", id: transactionId }, { reason, points: p.points, affiliateId: p.affiliateId });
    return { reversalId: revRef.id };
  });
});

/** Admin ajusta puntos manualmente con justificación obligatoria. */
export const adjustPoints = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "admin");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const affiliateId = str(d.affiliateId, "Afiliado", { max: 60 });
  const delta = int(d.delta, "Puntos", { min: -1_000_000, max: 1_000_000 });
  if (delta === 0) fail("invalid-argument", "El ajuste no puede ser 0.");
  const reason = str(d.reason, "Justificación", { min: 10, max: 500 });
  const key = idempotencyKey(d.idempotencyKey);
  const ref = db.doc(`${COL.transactions}/adj_${key}`);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return { transactionId: ref.id, replayed: true };
    const aff = await tx.get(db.doc(`${COL.affiliates}/${affiliateId}`));
    if (!aff.exists) fail("not-found", "Afiliado no encontrado.");
    const walletRef = db.doc(`${COL.wallets}/${affiliateId}`);
    const w = await tx.get(walletRef);
    signedPointsCheck(w.get("balance") - (w.get("reserved") ?? 0), delta);
    const now = FieldValue.serverTimestamp();
    tx.set(ref, {
      type: "adjustment", status: "confirmed", affiliateId, affiliateUid: aff.get("uid"), affiliateName: aff.get("fullName"),
      affiliateCode: aff.get("code"), distributorId: null, distributorName: null, amountCents: 0, points: delta,
      balanceAfter: w.get("balance") + delta, reason, flags: [], createdBy: actor.uid, createdByRole: "admin", idempotencyKey: key, createdAt: now,
    });
    tx.update(walletRef, { balance: FieldValue.increment(delta), totalAdjusted: FieldValue.increment(delta), updatedAt: now });
    bumpStats(tx, { pointsAdjusted: delta, pointsInCirculation: delta, adjustments: 1 });
    audit(tx, actor, "points.adjust", { type: "affiliate", id: affiliateId }, { delta, reason, transactionId: ref.id });
    return { transactionId: ref.id, replayed: false };
  });
});

/**
 * Verificación de consistencia: el saldo de cada billetera debe ser igual a la suma de puntos de sus movimientos,
 * y lo reservado debe coincidir con los canjes pendientes. Devuelve las diferencias encontradas.
 */
export const runIntegrityCheck = onCall({ ...callableOpts, timeoutSeconds: 300 }, async (req) => {
  const actor: Actor = requireRole(req, "admin");
  const after = typeof (req.data as { after?: unknown })?.after === "string" ? (req.data as { after: string }).after : null;
  let q = db.collection(COL.wallets).orderBy("__name__").limit(200);
  if (after) q = q.startAfter(after);
  const wallets = await q.get();
  const issues: Array<Record<string, unknown>> = [];
  for (const w of wallets.docs) {
    const [txs, pend] = await Promise.all([
      db.collection(COL.transactions).where("affiliateId", "==", w.id).select("points").get(),
      db.collection(COL.redemptions).where("affiliateId", "==", w.id).where("status", "==", "pending").select("pointsCost").get(),
    ]);
    const sum = txs.docs.reduce((s, t) => s + (t.get("points") as number), 0);
    const reserved = pend.docs.reduce((s, r) => s + (r.get("pointsCost") as number), 0);
    if (sum !== w.get("balance") || reserved !== (w.get("reserved") ?? 0))
      issues.push({ affiliateId: w.id, balance: w.get("balance"), expectedBalance: sum, reserved: w.get("reserved") ?? 0, expectedReserved: reserved });
  }
  await db.runTransaction(async (tx) => {
    audit(tx, actor, "integrity.check", { type: "system", id: "wallets" }, { scanned: wallets.size, issues: issues.length });
  });
  return { scanned: wallets.size, issues, next: wallets.size === 200 ? wallets.docs[wallets.size - 1].id : null };
});
