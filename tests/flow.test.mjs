/**
 * Pruebas de integración end-to-end: API PHP (servidor embebido) + emuladores de Firebase (Auth, Firestore).
 * Ejecuta: npm run test:integration
 * Verifica flujo completo + reglas de seguridad + protecciones (idempotencia, duplicados, doble descuento).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp as initAdmin } from "firebase-admin/app";
import { getAuth as adminAuth } from "firebase-admin/auth";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, orderBy,
} from "firebase/firestore";

const PROJECT = "demo-red-puntos";
const API = process.env.R3_API_URL ?? "http://127.0.0.1:8000/api";
initAdmin({ projectId: PROJECT });

const clients = [];
function client(name) {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  // Llama al API PHP (mismo protocolo que usa el frontend)
  const call = async (fn, data) => {
    const headers = { "Content-Type": "application/json" };
    if (auth.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
    const r = await fetch(`${API}/${fn}`, { method: "POST", headers, body: JSON.stringify({ data }) });
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message); e.code = "functions/" + j.error.status.toLowerCase().replace(/_/g, "-"); e.details = j.error.details; throw e; }
    return j.result;
  };
  const c = { app, auth, db, call, login: async (e, p) => { await signInWithEmailAndPassword(auth, e, p); await auth.currentUser.getIdToken(true); } };
  clients.push(c);
  return c;
}
const key = () => randomUUID();
async function rejects(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(String(e.code).includes(code), `esperado ${code}, obtenido ${e.code}: ${e.message}`);
    return true;
  });
}

const admin = client("admin"), d1 = client("d1"), d2 = client("d2"), a1 = client("a1"), a2 = client("a2"), anon = client("anon");
const S = {};

before(async () => {
  const u = await adminAuth().createUser({ email: "admin@test.ec", password: "Admin12345" });
  await adminAuth().setCustomUserClaims(u.uid, { role: "admin" });
  await admin.login("admin@test.ec", "Admin12345");
});

test("admin crea distribuidores con cuentas de acceso", async () => {
  const r1 = await admin.call("createDistributor", { name: "Distribuidora Norte", email: "norte@test.ec", password: "Norte12345", city: "Quito", phone: "0991234567" });
  const r2 = await admin.call("createDistributor", { name: "Comercial Sur", email: "sur@test.ec", password: "Sur123456", city: "Guayaquil" });
  assert.match(r1.registrationCode, /^D-[A-Z0-9]{5}$/);
  S.d1 = r1.distributorId; S.d1code = r1.registrationCode; S.d2 = r2.distributorId;
  await d1.login("norte@test.ec", "Norte12345");
  await d2.login("sur@test.ec", "Sur123456");
  const tok = await d1.auth.currentUser.getIdTokenResult();
  assert.equal(tok.claims.role, "distributor");
  assert.equal(tok.claims.distributorId, S.d1);
});

test("un no-admin no puede crear distribuidores", async () => {
  await rejects(d1.call("createDistributor", { name: "X", email: "x@test.ec", password: "x12345678" }), "permission-denied");
  await rejects(anon.call("createDistributor", { name: "X", email: "x@test.ec", password: "x12345678" }), "unauthenticated");
});

test("registro público de afiliados (con y sin QR de distribuidor)", async () => {
  const r1 = await anon.call("registerAffiliate", {
    fullName: "María José Pérez", idType: "cedula", idNumber: "1710034065", phone: "0987654321", password: "Socio12345",
    distributorCode: S.d1code, acceptTerms: true,
  });
  assert.match(r1.code, /^AF-[A-Z0-9]{7}$/);
  S.a1 = r1.affiliateId;
  await a1.login(r1.loginEmail, "Socio12345");
  const r2 = await anon.call("registerAffiliate", {
    fullName: "Carlos Núñez", idType: "pasaporte", idNumber: "AB123456", phone: "+593 99 111 2222", password: "Socio67890", acceptTerms: true,
  });
  S.a2 = r2.affiliateId;
  await a2.login(r2.loginEmail, "Socio67890");
  await rejects(anon.call("registerAffiliate", {
    fullName: "Duplicado", idType: "cedula", idNumber: "1710034065", phone: "0987654321", password: "Socio12345", acceptTerms: true,
  }), "already-exists");
  await rejects(anon.call("registerAffiliate", {
    fullName: "Cédula Mala", idType: "cedula", idNumber: "1710034066", phone: "0987654321", password: "Socio12345", acceptTerms: true,
  }), "invalid-argument");
  const me = (await getDoc(doc(a1.db, "affiliates", S.a1))).data();
  assert.equal(me.distributorId, S.d1);
  assert.equal(me.qrToken.length, 32);
  S.a1qr = "RPA1:" + me.qrToken;
  const dist = (await getDoc(doc(d1.db, "distributors", S.d1))).data();
  assert.equal(dist.affiliateCount, 1);
});

test("el distribuidor identifica al afiliado por QR sin ver datos sensibles", async () => {
  const r = await d1.call("lookupAffiliate", { content: S.a1qr });
  assert.equal(r.id, S.a1);
  assert.equal(r.fullName, "María José Pérez");
  assert.equal(r.linkedToYou, true);
  assert.ok(!("balance" in r) && !("phone" in r) && r.idMasked.endsWith("4065") && !r.idMasked.includes("1710"));
  await rejects(a2.call("lookupAffiliate", { content: S.a1qr }), "permission-denied");
  const s = await d2.call("searchAffiliates", { q: "maria" });
  assert.equal(s.results.length, 1);
});

test("compra de $250.50 = 250 puntos, calculado en backend e idempotente", async () => {
  const k = key();
  const r = await d1.call("registerPurchase", { affiliateId: S.a1, amountCents: 25050, idempotencyKey: k, points: 999999 });
  assert.equal(r.points, 250);
  assert.equal(r.replayed, false);
  const again = await d1.call("registerPurchase", { affiliateId: S.a1, amountCents: 25050, idempotencyKey: k });
  assert.equal(again.replayed, true);
  assert.equal(again.transactionId, r.transactionId);
  const w = (await getDoc(doc(a1.db, "points_wallets", S.a1))).data();
  assert.equal(w.balance, 250);
  S.tx1 = r.transactionId;
});

test("detecta compra duplicada y exige confirmación explícita", async () => {
  await rejects(d1.call("registerPurchase", { affiliateId: S.a1, amountCents: 25050, idempotencyKey: key() }), "failed-precondition");
  const r = await d1.call("registerPurchase", { affiliateId: S.a1, amountCents: 25050, idempotencyKey: key(), confirmDuplicate: true });
  assert.deepEqual(r.flags, ["possible_duplicate"]);
  S.txDup = r.transactionId;
  const flagged = await getDocs(query(collection(admin.db, "transactions"), where("flags", "array-contains", "possible_duplicate")));
  assert.equal(flagged.size, 1);
});

test("validación de montos", async () => {
  await rejects(d1.call("registerPurchase", { affiliateId: S.a1, amountCents: 50, idempotencyKey: key() }), "invalid-argument");
  await rejects(d1.call("registerPurchase", { affiliateId: S.a1, amountCents: 10.5, idempotencyKey: key() }), "invalid-argument");
  await rejects(d1.call("registerPurchase", { affiliateId: S.a1, amountCents: 999_999_99, idempotencyKey: key() }), "invalid-argument");
});

test("los puntos son del afiliado: acumula en cualquier distribuidor", async () => {
  const r = await d2.call("registerPurchase", { affiliateId: S.a1, amountCents: 1000, idempotencyKey: key() });
  assert.equal(r.points, 10);
  const r2 = await d2.call("registerPurchase", { affiliateId: S.a2, amountCents: 15000, idempotencyKey: key() });
  assert.equal(r2.points, 150);
  S.txA2 = r2.transactionId;
  const w = (await getDoc(doc(a1.db, "points_wallets", S.a1))).data();
  assert.equal(w.balance, 250 + 250 + 10);
  // a2 no tenía distribuidor: queda vinculado al primero que registra su compra
  const d2doc = (await getDoc(doc(d2.db, "distributors", S.d2))).data();
  assert.equal(d2doc.affiliateCount, 1);
  assert.equal(d2doc.pointsGenerated, 160);
});

test("reglas: el distribuidor solo ve sus propias operaciones", async () => {
  const mine = await getDocs(query(collection(d1.db, "transactions"), where("distributorId", "==", S.d1), orderBy("createdAt", "desc")));
  assert.equal(mine.size, 2);
  await rejects(getDocs(query(collection(d1.db, "transactions"), where("distributorId", "==", S.d2))), "permission-denied");
  await rejects(getDocs(collection(d1.db, "transactions")), "permission-denied");
  await rejects(getDoc(doc(d1.db, "distributors", S.d2)), "permission-denied");
  await rejects(getDoc(doc(d1.db, "affiliates", S.a1)), "permission-denied");
  await rejects(getDoc(doc(d1.db, "points_wallets", S.a1)), "permission-denied");
  await rejects(getDoc(doc(d1.db, "stats", "global")), "permission-denied");
  await rejects(getDocs(collection(d1.db, "audit_logs")), "permission-denied");
});

test("reglas: nadie modifica saldos ni transacciones desde el frontend", async () => {
  await rejects(updateDoc(doc(a1.db, "points_wallets", S.a1), { balance: 1_000_000 }), "permission-denied");
  await rejects(setDoc(doc(d1.db, "transactions", "fake"), { distributorId: S.d1, points: 5000 }), "permission-denied");
  await rejects(updateDoc(doc(admin.db, "points_wallets", S.a1), { balance: 1 }), "permission-denied");
  await rejects(updateDoc(doc(d1.db, "distributors", S.d1), { pointsGenerated: 1 }), "permission-denied");
  await rejects(setDoc(doc(a1.db, "config", "points"), { pointsPerDollar: 100 }), "permission-denied");
  await rejects(d1.call("adjustPoints", { affiliateId: S.a1, delta: 500, reason: "quiero más puntos", idempotencyKey: key() }), "permission-denied");
  await rejects(d1.call("reversePurchase", { transactionId: S.tx1, reason: "borrar esta compra" }), "permission-denied");
  await rejects(d1.call("updatePointsConfig", { pointsPerDollar: 10 }), "permission-denied");
});

test("reglas: el afiliado solo ve lo suyo", async () => {
  const mine = await getDocs(query(collection(a1.db, "transactions"), where("affiliateId", "==", S.a1)));
  assert.equal(mine.size, 3);
  await rejects(getDocs(query(collection(a1.db, "transactions"), where("affiliateId", "==", S.a2))), "permission-denied");
  await rejects(getDoc(doc(a1.db, "affiliates", S.a2)), "permission-denied");
  await rejects(getDoc(doc(a1.db, "points_wallets", S.a2)), "permission-denied");
});

test("recompensas y canjes: reserva, aprobación única, código y entrega", async () => {
  const { id: rewardId } = await admin.call("saveReward", { name: "Gorra oficial", description: "Gorra bordada", pointsCost: 300, stock: 5, active: true });
  const { id: inactive } = await admin.call("saveReward", { name: "Oculta", pointsCost: 10, stock: null, active: false });
  await rejects(getDoc(doc(a1.db, "rewards", inactive)), "permission-denied");
  const catalog = await getDocs(query(collection(a1.db, "rewards"), where("active", "==", true)));
  assert.equal(catalog.size, 1);

  const k = key();
  const { redemptionId } = await a1.call("requestRedemption", { rewardId, idempotencyKey: k });
  assert.equal((await a1.call("requestRedemption", { rewardId, idempotencyKey: k })).replayed, true);
  let w = (await getDoc(doc(a1.db, "points_wallets", S.a1))).data();
  assert.equal(w.reserved, 300);
  assert.equal(w.balance, 510);
  // 510 - 300 reservados = 210 disponibles < 300
  await rejects(a1.call("requestRedemption", { rewardId, idempotencyKey: key() }), "failed-precondition");

  const ap = await admin.call("resolveRedemption", { redemptionId, action: "approve" });
  assert.match(ap.code, /^CJ-[A-Z0-9]{8}$/);
  await rejects(admin.call("resolveRedemption", { redemptionId, action: "approve" }), "failed-precondition");
  await rejects(admin.call("resolveRedemption", { redemptionId, action: "reject", note: "tarde" }), "failed-precondition");
  w = (await getDoc(doc(a1.db, "points_wallets", S.a1))).data();
  assert.equal(w.balance, 210);
  assert.equal(w.reserved, 0);
  const red = (await getDoc(doc(a1.db, "redemptions", redemptionId))).data();
  assert.equal(red.status, "approved");
  assert.equal(red.code, ap.code);
  assert.ok(red.approvedBy);
  await admin.call("resolveRedemption", { redemptionId, action: "deliver" });
  const rw = (await getDoc(doc(admin.db, "rewards", rewardId))).data();
  assert.equal(rw.stock, 4);
});

test("canje rechazado o cancelado libera la reserva", async () => {
  const { id: rewardId } = await admin.call("saveReward", { name: "Taza", pointsCost: 100, stock: null, active: true });
  const { redemptionId: r1 } = await a1.call("requestRedemption", { rewardId, idempotencyKey: key() });
  await rejects(admin.call("resolveRedemption", { redemptionId: r1, action: "reject" }), "invalid-argument");
  await admin.call("resolveRedemption", { redemptionId: r1, action: "reject", note: "Sin stock en bodega" });
  const { redemptionId: r2 } = await a1.call("requestRedemption", { rewardId, idempotencyKey: key() });
  await rejects(a2.call("cancelRedemption", { redemptionId: r2 }), "not-found");
  await a1.call("cancelRedemption", { redemptionId: r2 });
  const w = (await getDoc(doc(a1.db, "points_wallets", S.a1))).data();
  assert.equal(w.reserved, 0);
  assert.equal(w.balance, 210);
});

test("ajuste con justificación y reverso de compra", async () => {
  await rejects(admin.call("adjustPoints", { affiliateId: S.a2, delta: 50, reason: "corto", idempotencyKey: key() }), "invalid-argument");
  await admin.call("adjustPoints", { affiliateId: S.a2, delta: 50, reason: "Bonificación por campaña de lanzamiento", idempotencyKey: key() });
  await rejects(admin.call("adjustPoints", { affiliateId: S.a2, delta: -1000, reason: "Corrección de saldo excesiva", idempotencyKey: key() }), "failed-precondition");
  // a1 ya gastó puntos (saldo 210 < 250): no se puede revertir sin dejar saldo negativo
  await rejects(admin.call("reversePurchase", { transactionId: S.txDup, reason: "Compra duplicada confirmada con el distribuidor" }), "failed-precondition");
  await admin.call("reversePurchase", { transactionId: S.txA2, reason: "Factura anulada por el distribuidor" });
  await rejects(admin.call("reversePurchase", { transactionId: S.txA2, reason: "Factura anulada por el distribuidor" }), "failed-precondition");
  const w = (await getDoc(doc(a2.db, "points_wallets", S.a2))).data();
  assert.equal(w.balance, 150 + 50 - 150);
  const orig = (await getDoc(doc(admin.db, "transactions", S.txA2))).data();
  assert.equal(orig.status, "reversed");
  // el distribuidor ve el estado de su transacción, pero el reverso no se elimina
  const seen = (await getDoc(doc(d2.db, "transactions", S.txA2))).data();
  assert.equal(seen.status, "reversed");
});

test("estadísticas globales y verificación de consistencia", async () => {
  const s = (await getDoc(doc(admin.db, "stats", "global"))).data();
  assert.equal(s.distributorsActive, 2);
  assert.equal(s.affiliates, 2);
  assert.equal(s.purchases, 3); // 4 compras - 1 reverso
  assert.equal(s.pointsRedeemed, 300);
  const walletsSum = (await getDocs(collection(admin.db, "points_wallets"))).docs.reduce((t, d) => t + d.get("balance"), 0);
  assert.equal(s.pointsInCirculation, walletsSum);
  const chk = await admin.call("runIntegrityCheck", {});
  assert.equal(chk.scanned, 2);
  assert.deepEqual(chk.issues, []);
  const logs = await getDocs(collection(admin.db, "audit_logs"));
  assert.ok(logs.size >= 15);
});

test("distribuidor desactivado no puede operar", async () => {
  await admin.call("setAccountStatus", { targetType: "distributor", id: S.d2, status: "inactive", reason: "Fin de contrato" });
  await rejects(d2.call("registerPurchase", { affiliateId: S.a1, amountCents: 1000, idempotencyKey: key() }), "");
  const s = (await getDoc(doc(admin.db, "stats", "global"))).data();
  assert.equal(s.distributorsActive, 1);
  for (const c of clients) await deleteApp(c.app);
});
