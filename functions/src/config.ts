import { onCall } from "firebase-functions/v2/https";
import { COL, FieldValue, audit, db, fail, getPointsConfig, int, requireRole } from "./lib/core";
import { PointsConfig, Rounding } from "./shared/domain";
import { callableOpts } from "./lib/options";

/** Admin actualiza las reglas de acumulación. Cada cambio queda auditado con valores anteriores y nuevos. */
export const updatePointsConfig = onCall(callableOpts, async (req) => {
  const actor = requireRole(req, "admin");
  const d = (req.data ?? {}) as Record<string, unknown>;
  const ppd = d.pointsPerDollar;
  if (typeof ppd !== "number" || !(ppd > 0 && ppd <= 100) || Math.round(ppd * 100) !== ppd * 100)
    fail("invalid-argument", "Puntos por dólar debe ser un número entre 0.01 y 100 (máx. 2 decimales).");
  const rounding = d.rounding as Rounding;
  if (!["floor", "round", "ceil"].includes(rounding)) fail("invalid-argument", "Redondeo inválido.");
  const pv = d.pointValueUsd;
  if (typeof pv !== "number" || !(pv >= 0 && pv <= 100)) fail("invalid-argument", "Valor del punto inválido.");
  const next: PointsConfig = {
    pointsPerDollar: ppd,
    rounding,
    minPurchaseCents: int(d.minPurchaseCents, "Compra mínima", { min: 1, max: 100_000_000 }),
    maxPurchaseCents: int(d.maxPurchaseCents, "Compra máxima", { min: 1, max: 100_000_000 }),
    duplicateWindowSeconds: int(d.duplicateWindowSeconds, "Ventana de duplicados", { min: 0, max: 86_400 }),
    pointValueUsd: pv,
    requireDistributorOnSignup: d.requireDistributorOnSignup === true,
  };
  if (next.minPurchaseCents > next.maxPurchaseCents) fail("invalid-argument", "La compra mínima no puede superar la máxima.");
  await db.runTransaction(async (tx) => {
    const before = await getPointsConfig(tx);
    tx.set(db.doc(`${COL.config}/points`), { ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
    audit(tx, actor, "config.points.update", { type: "config", id: "points" }, { before, after: next });
  });
  return { ok: true };
});
