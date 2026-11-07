/**
 * Prueba E2E de interfaz (Playwright) contra emuladores + servidor Vite.
 * Requisitos: emuladores corriendo (npm run emulators) y `npm --prefix web run dev` en :5173.
 * Uso: node tests/e2e-ui.mjs [carpeta-capturas]
 * Recorre: admin crea distribuidor → socio se registra con QR del distribuidor → distribuidor ESCANEA el QR
 * (cámara simulada con un video del QR real) y registra $250.50 → socio ve 250 pts → canje → aprobación.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const QRCode = require("./../web/node_modules/qrcode");

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
const { initializeApp } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore } = await import("firebase-admin/firestore");
initializeApp({ projectId: "demo-red-puntos" });

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const OUT = process.argv[2] ?? "test-results/ui";
mkdirSync(OUT, { recursive: true });
const shot = async (page, name) => { await page.waitForTimeout(450); return page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false }); };
const run = Date.now().toString(36).toUpperCase();

// Admin principal (solo por CLI, como en producción)
const adminEmail = `admin-${run.toLowerCase()}@demo.ec`;
const u = await getAuth().createUser({ email: adminEmail, password: "Admin12345", displayName: "Administración" });
await getAuth().setCustomUserClaims(u.uid, { role: "admin" });
await getFirestore().doc(`users/${u.uid}`).set({ role: "admin", displayName: "Administración", email: adminEmail, status: "active" });

const browser = await chromium.launch();
const desktop = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
const admin = await desktop.newPage();
admin.on("pageerror", (e) => console.error("[admin pageerror]", e.message));

// 1. Admin inicia sesión y crea distribuidor
await admin.goto(`${BASE}/ingresar`);
await shot(admin, "01-login");
await admin.getByLabel("Cédula, pasaporte o correo").fill(adminEmail);
await admin.getByLabel("Contraseña").fill("Admin12345");
await admin.getByRole("button", { name: "Ingresar" }).click();
await admin.waitForURL("**/admin");
await admin.getByText("Resumen de la red").waitFor();
await admin.goto(`${BASE}/admin/distribuidores`);
await admin.getByRole("button", { name: "Nuevo distribuidor" }).click();
const distEmail = `norte-${run.toLowerCase()}@demo.ec`;
await admin.getByLabel("Nombre comercial *").fill(`Distribuidora Norte ${run}`);
await admin.getByLabel("Correo de acceso *").fill(distEmail);
await admin.getByLabel("Ciudad").fill("Quito");
await admin.getByLabel("Teléfono").fill("0991234567");
await admin.getByLabel("Contraseña inicial *").fill("Norte12345");
await admin.getByRole("button", { name: "Crear distribuidor y cuenta" }).click();
await admin.getByText("Distribuidor creado").waitFor();
const regCode = (await admin.locator("dt:has-text('Código de registro') + dd").textContent()).trim();
assert.match(regCode, /^D-/);
await shot(admin, "02-admin-distribuidor-creado");
await admin.getByRole("button", { name: "Listo" }).click();

// 2. Socio se registra desde el QR del distribuidor (móvil)
const phone = await browser.newContext({ ...devices["iPhone 13"] });
const aff = await phone.newPage();
aff.on("pageerror", (e) => console.error("[aff pageerror]", e.message));
await aff.goto(`${BASE}/registro?d=${regCode}`);
await aff.getByText("Te registras con").waitFor();
const cedula = ["1710034065", "0926687856", "1713175071", "0102030405"][0];
// cédula única por corrida: generamos una válida
const genCedula = () => {
  for (;;) {
    const base = "17" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0").replace(/^[6-9]/, "1");
    const c = [2, 1, 2, 1, 2, 1, 2, 1, 2];
    let s = 0; for (let i = 0; i < 9; i++) { let v = Number(base[i]) * c[i]; if (v >= 10) v -= 9; s += v; }
    return base + ((10 - (s % 10)) % 10);
  }
};
const myId = run ? genCedula() : cedula;
await aff.getByLabel("Nombre completo").fill("María José Pérez");
await aff.getByLabel("Número de identificación").fill(myId);
await aff.getByLabel("Celular").fill("0987654321");
await aff.getByLabel("Contraseña", { exact: true }).fill("Socio12345");
await aff.getByLabel("Repite la contraseña").fill("Socio12345");
await shot(aff, "03-registro-socio");
await aff.locator("input[type=checkbox]").check();
await aff.getByRole("button", { name: "Crear mi cuenta" }).click();
await aff.getByText("Tu código de socio es").waitFor({ timeout: 20000 });
await aff.getByRole("button", { name: "Ver mi QR" }).click();
await aff.waitForURL("**/socio/qr");
await aff.getByText("Mi QR de socio").waitFor();
await aff.waitForTimeout(500);
await shot(aff, "04-socio-qr");

// QR real del socio → video para la cámara simulada del distribuidor
const affDoc = (await getFirestore().collection("affiliates").where("idNumber", "==", myId).get()).docs[0];
const qrContent = "RPA1:" + affDoc.get("qrToken");
const png = join(OUT, "qr.png"), y4m = join(OUT, "qr.y4m");
await QRCode.toFile(png, qrContent, { width: 480, margin: 6 });
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", png, "-t", "3", "-vf", "scale=640:640,format=yuv420p", "-r", "15", y4m]);

// 3. Distribuidor escanea y registra compra de $250.50
const camBrowser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`] });
const distCtx = await camBrowser.newContext({ ...devices["Pixel 7"], permissions: ["camera"] });
const dist = await distCtx.newPage();
dist.on("pageerror", (e) => console.error("[dist pageerror]", e.message));
await dist.goto(`${BASE}/ingresar`);
await dist.getByLabel("Cédula, pasaporte o correo").fill(distEmail);
await dist.getByLabel("Contraseña").fill("Norte12345");
await dist.getByRole("button", { name: "Ingresar" }).click();
await dist.waitForURL("**/distribuidor");
await dist.getByText("Registrar compra").first().waitFor();
await shot(dist, "05-distribuidor-inicio");
await dist.getByText("Registrar compra").first().click();
await dist.getByText("Monto de la compra (USD)").waitFor({ timeout: 20000 }); // identificado por QR
for (const k of ["2", "5", "0", ".", "5", "0"]) await dist.getByRole("button", { name: k, exact: true }).click();
await dist.getByText("≈ 250 puntos").waitFor();
await shot(dist, "06-distribuidor-monto");
await dist.getByRole("button", { name: "Continuar" }).click();
await dist.getByText("Puntos a acreditar").waitFor();
await shot(dist, "07-distribuidor-confirmar");
await dist.getByRole("button", { name: "Confirmar y acreditar" }).click();
await dist.getByText("+250").waitFor({ timeout: 15000 });
await shot(dist, "08-distribuidor-exito");

// 4. Socio ve su saldo actualizado en tiempo real
await aff.goto(`${BASE}/socio`);
await aff.getByText("Puntos disponibles").waitFor();
await aff.locator("[aria-live=polite]", { hasText: "250" }).waitFor({ timeout: 10000 });
await aff.waitForTimeout(400);
await shot(aff, "09-socio-wallet");

// 5. Admin crea recompensa; socio la canjea; admin aprueba
await admin.goto(`${BASE}/admin/recompensas`);
await admin.getByRole("button", { name: "Nueva recompensa" }).click();
await admin.getByLabel("Nombre *").fill(`Termo de acero 750 ml ${run}`);
await admin.getByLabel("Descripción").fill("Termo térmico con logo de la red.");
await admin.getByLabel("Puntos necesarios *").fill("200");
await admin.getByLabel("Disponibilidad (stock)").fill("20");
await admin.getByRole("button", { name: "Guardar" }).click();
await admin.getByText("Recompensa creada").waitFor();

await aff.goto(`${BASE}/socio/recompensas`);
await aff.getByText(`Termo de acero 750 ml ${run}`).first().click();
await aff.getByRole("button", { name: "Solicitar canje" }).click();
await aff.getByText("Canje solicitado").waitFor();
await aff.getByText("Pendiente").first().waitFor();
await shot(aff, "10-socio-canjes");

await admin.goto(`${BASE}/admin/canjes`);
await admin.getByRole("button", { name: "Revisar" }).first().click();
await admin.getByRole("button", { name: "Aprobar" }).click();
await admin.getByText(/Canje aprobado · código CJ-/).waitFor();

await aff.goto(`${BASE}/socio`);
await aff.locator("[aria-live=polite]", { hasText: /^50$/ }).waitFor({ timeout: 10000 });

// 6. Panel admin con datos reales
await admin.goto(`${BASE}/admin`);
await admin.getByText("Puntos en circulación").waitFor();
await admin.waitForTimeout(1200);
await shot(admin, "11-admin-dashboard");
await admin.goto(`${BASE}/admin/transacciones`);
await admin.getByText("María José Pérez").first().waitFor();
await shot(admin, "12-admin-transacciones");

// 7. Seguridad en UI: el distribuidor no puede abrir el panel admin
await dist.goto(`${BASE}/admin`);
await dist.waitForURL("**/distribuidor");

await browser.close(); await camBrowser.close();
writeFileSync(join(OUT, "ok.txt"), "ok");
console.log("E2E UI OK →", OUT);
process.exit(0);
