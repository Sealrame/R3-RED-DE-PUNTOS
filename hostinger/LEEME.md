# Publicar R3 Puntos en Hostinger (plan gratuito de Firebase)

## Arquitectura
- **Hostinger** (`puntos.r3reddetalleres.com`): la app web + el API PHP en `/api` (calcula puntos, canjes, cuentas) + imágenes en `/uploads`.
- **Firebase Spark (gratis)**: inicio de sesión (Authentication) y base de datos (Firestore) con reglas que bloquean toda escritura desde el navegador.
- El API PHP usa una **cuenta de servicio** guardada en `r3-private/`, **fuera de `public_html`**.

## 1. Firebase (una vez)
1. Authentication → Comenzar → Correo electrónico/contraseña → Habilitar.
2. Firestore Database → Crear → `us-east1` → modo producción.
3. Authentication → Configuración → Dominios autorizados → Agregar `puntos.r3reddetalleres.com`.
4. Configuración del proyecto → Cuentas de servicio → **Generar nueva clave privada** → se descarga un `.json`. Renómbralo `service-account.json`. **No lo compartas ni lo subas a GitHub.**
5. En tu PC, dentro del proyecto: `npx firebase login` y luego `npm run deploy:rules` (publica reglas e índices de Firestore).

## 2. Hostinger
1. hPanel → Dominios → **Subdominios** → crea `puntos` (carpeta `public_html/puntos`).
2. hPanel → Seguridad → **SSL**: activa el certificado gratuito para `puntos.r3reddetalleres.com`.
3. hPanel → Avanzado → **Configuración de PHP**: versión **8.2 o superior**.
4. Administrador de archivos → `public_html/puntos` → **Subir** `r3-puntos-hostinger.zip` → clic derecho → **Extraer** → borra el zip.
5. Administrador de archivos → sube un nivel hasta `domains/r3reddetalleres.com/` (donde está `public_html`) → crea la carpeta **`r3-private`** → sube ahí `config.php` (de `hostinger/r3-private/`) y tu `service-account.json`.

## 3. Primer administrador
En tu PC, con `service-account.json` en la carpeta del proyecto (PowerShell):
```
$env:GOOGLE_APPLICATION_CREDENTIALS = ".\service-account.json"
node scripts/create-admin.mjs --project r3-puntos --email TU_CORREO --password "CLAVE_SEGURA" --name "Tu nombre"
```

## Actualizar la app
`git pull` → `npm run install:all` → `npm run package:hostinger` → sube y extrae el nuevo zip en `public_html/puntos` (reemplazando).
