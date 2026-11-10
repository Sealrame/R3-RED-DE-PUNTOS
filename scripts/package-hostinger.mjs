#!/usr/bin/env node
// Empaqueta web/dist (app + API PHP) en r3-puntos-hostinger.zip para subir a Hostinger.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
const out = "r3-puntos-hostinger.zip";
if (existsSync(out)) rmSync(out);
execFileSync("tar", ["-a", "-cf", `../../${out}`, "."], { cwd: "web/dist", stdio: "inherit" });
console.log(`Listo: ${out} → súbelo y descomprímelo en la carpeta del subdominio en Hostinger.`);
