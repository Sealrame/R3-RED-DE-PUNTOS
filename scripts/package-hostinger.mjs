#!/usr/bin/env node
// Empaqueta web/dist (app + API PHP) en r3-puntos-hostinger.zip para subir a Hostinger.
// Usa el tar incluido en Windows 10/11 (bsdtar) con nombres explícitos (sin prefijo "./", que Windows no muestra).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
const out = "r3-puntos-hostinger.zip";
if (existsSync(out)) rmSync(out);
const entries = readdirSync("web/dist");
if (!entries.includes("index.html") || !entries.includes("api")) {
  console.error("Falta la compilación: ejecuta primero npm --prefix web run build");
  process.exit(1);
}
execFileSync("tar", ["-a", "-cf", `../../${out}`, ...entries], { cwd: "web/dist", stdio: "inherit" });
console.log(`Listo: ${out} (${entries.length} elementos) → súbelo y extráelo en public_html/puntos en Hostinger.`);
