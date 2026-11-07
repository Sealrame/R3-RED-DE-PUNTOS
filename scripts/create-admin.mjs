#!/usr/bin/env node
/**
 * Crea (o promueve) la cuenta del ADMINISTRADOR PRINCIPAL.
 * Es la única forma de obtener el rol admin: no existe ninguna ruta en la app para auto-asignárselo.
 *
 * Producción:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   node scripts/create-admin.mjs --project <ID_PROYECTO> --email admin@empresa.ec --password '********' --name "Nombre"
 *
 * Emulador:
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   node scripts/create-admin.mjs --project demo-red-puntos --email admin@demo.ec --password 'Admin12345' --name "Admin"
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const { project, email, password, name = "Administrador" } = args;
// --emulator true: usar los emuladores locales (funciona igual en Windows, Mac y Linux)
if (args.emulator) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
}
if (!project || !email) {
  console.error("Uso: node scripts/create-admin.mjs --project <id> --email <correo> [--password <clave>] [--name <nombre>]");
  process.exit(1);
}

initializeApp({ projectId: project });
const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(email);
  if (password) await auth.updateUser(user.uid, { password });
  console.log("Usuario existente, se promueve a admin:", user.uid);
} catch {
  if (!password || password.length < 8) {
    console.error("La cuenta no existe: indica --password (mínimo 8 caracteres).");
    process.exit(1);
  }
  user = await auth.createUser({ email, password, displayName: name });
  console.log("Usuario creado:", user.uid);
}
await auth.setCustomUserClaims(user.uid, { role: "admin" });
await db.doc(`users/${user.uid}`).set(
  { role: "admin", displayName: name, email, status: "active", createdAt: FieldValue.serverTimestamp() },
  { merge: true },
);
await db.collection("audit_logs").add({
  action: "admin.bootstrap", actorUid: "cli", actorRole: "system", targetType: "user", targetId: user.uid,
  data: { email }, createdAt: FieldValue.serverTimestamp(),
});
console.log(`Listo. ${email} ahora es administrador principal.`);
process.exit(0);
