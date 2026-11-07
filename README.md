# Red Puntos — Plataforma de fidelización para una red de distribuidores (Ecuador)

Plataforma funcional con tres tipos de cuenta (**Administrador principal**, **Distribuidor**, **Socio/Afiliado**), QR personal por socio, escaneo con cámara, registro de compras con acumulación automática de puntos (**$1 = 1 punto**, redondeo hacia abajo), recompensas con canjes, auditoría y reportes.

Los puntos pertenecen al socio y se acumulan centralmente, compre donde compre dentro de la red.

---

## 1. Arquitectura

```
┌──────────────────────────── Navegador (PWA móvil / escritorio) ───────────────────────────┐
│ React 19 + TypeScript + Vite + Tailwind 4                                                  │
│  /socio  (wallet, QR, premios)   /distribuidor (registrar compra, historial)   /admin      │
│  Lee en tiempo real con Firestore (solo lo que las reglas permiten)                        │
│  Escribe EXCLUSIVAMENTE mediante Cloud Functions invocables (httpsCallable)               │
└───────────────┬───────────────────────────────────────────────┬────────────────────────────┘
                │ ID token con custom claims {role, distributorId, affiliateId}
┌───────────────▼──────────────┐          ┌─────────────────────▼──────────────────────────┐
│ Firebase Authentication      │          │ Cloud Functions v2 (Node 22, us-east1)          │
│ email+contraseña             │          │ Validación, cálculo de puntos, idempotencia,    │
│ (socios: cédula → correo     │          │ transacciones atómicas, contadores, auditoría   │
│  sintético interno)          │          └─────────────────────┬──────────────────────────┘
└──────────────────────────────┘                                │ Admin SDK
                                   ┌────────────────────────────▼───────────────────────────┐
                                   │ Cloud Firestore  + Security Rules (escritura cliente = 0)│
                                   │ Cloud Storage (imágenes de recompensas, solo admin)      │
                                   └─────────────────────────────────────────────────────────┘
```

**Por qué esta arquitectura:** se respetó la preferencia (React + TS + Firebase). Usé **Vite** en vez de Next.js porque es una SPA autenticada (no necesita SEO ni SSR) y se despliega como estático en Firebase Hosting, sin servidores adicionales. Toda la lógica sensible está en Cloud Functions; el frontend nunca toca saldos.

### Estructura del repositorio

```
firebase.json · firestore.rules · firestore.indexes.json · storage.rules
functions/
  src/shared/domain.ts   ← reglas de negocio puras (puntos, cédula, QR, montos) compartidas con el frontend
  src/lib/core.ts        ← roles, validación, auditoría, contadores, códigos únicos
  src/affiliates.ts      ← registro público, búsqueda, identificación por QR, perfil
  src/distributors.ts    ← alta/edición de distribuidores, activar/desactivar cuentas, reset de contraseña
  src/purchases.ts       ← registrar compra, reverso, ajuste manual, verificación de consistencia
  src/rewards.ts         ← recompensas, solicitud / cancelación / aprobación / rechazo / entrega de canjes
  src/config.ts          ← reglas de acumulación
  test/domain.test.ts    ← pruebas unitarias
web/src/
  auth/ layouts/ components/ (UI, QR, escáner, gráficos) lib/ (firebase, api, hooks, csv)
  pages/public · pages/affiliate · pages/distributor · pages/admin
scripts/create-admin.mjs ← único modo de crear al administrador principal
tests/flow.test.mjs      ← integración contra emuladores (flujo + reglas de seguridad)
tests/e2e-ui.mjs         ← E2E de interfaz con Playwright y cámara simulada
```

## 2. Modelo de datos (Cloud Firestore)

| Colección | ID | Contenido principal | Quién lee |
|---|---|---|---|
| `users/{uid}` | uid de Auth | role, distributorId / affiliateId, displayName, status | el propio usuario, admin |
| `distributors/{id}` | auto | name, ruc, contacto, ciudad, `registrationCode` (D-XXXXX), status, ownerUid, contadores: affiliateCount, purchaseCount, pointsGenerated, salesCents | ese distribuidor, admin |
| `distributors/{id}/monthly/{YYYY-MM}` | mes | purchases, salesCents, pointsGenerated, newAffiliates | ese distribuidor, admin |
| `affiliates/{id}` | auto | uid, fullName, idType, idNumber, phone, email, `code` (AF-XXXXXXX), `qrToken` (192 bits aleatorios), distributorId (vinculación), status | el propio socio, admin |
| `points_wallets/{affiliateId}` | = afiliado | **balance**, reserved, totalEarned, totalRedeemed, totalAdjusted, lastPurchase | el propio socio, admin |
| `transactions/{id}` | determinístico | type (purchase / reversal / redemption / adjustment), status (confirmed / reversed), affiliateId, distributorId, amountCents, **points (con signo)**, balanceAfter, reference, flags, createdBy, createdAt, rule aplicada | admin; distribuidor solo las suyas; socio solo las suyas |
| `rewards/{id}` | auto | name, description, pointsCost, imageUrl, stock (null = ilimitado), active | autenticados (solo activas), admin |
| `redemptions/{id}` | `red_{afiliado}_{clave}` | rewardId, pointsCost, status (pending / approved / delivered / rejected / cancelled), code (CJ-XXXXXXXX), approvedBy, history | el propio socio, admin |
| `audit_logs/{id}` | auto | action, actorUid, actorRole, targetType, targetId, data (antes/después), createdAt | admin |
| `config/points` | — | pointsPerDollar, rounding, min/max de compra, ventana anti-duplicados, valor del punto, exigir distribuidor al registrarse | autenticados |
| `stats/global` · `stats_monthly/{YYYY-MM}` | — | contadores agregados del dashboard | admin |
| `registry/{clave}` | — | unicidad de cédula/RUC/pasaporte y de códigos | nadie (solo backend) |

Los montos se guardan como **centavos enteros** (sin errores de coma flotante). El saldo vive en una sola billetera por socio y no depende del distribuidor.

**Invariante verificable:** `wallet.balance == Σ transactions.points` del socio, y `wallet.reserved == Σ` de sus canjes pendientes. El panel *Control y auditoría* ejecuta esa verificación.

## 3. Seguridad y control

- **Roles en custom claims** firmados por el backend. Nadie puede auto-asignarse un rol; el admin principal se crea solo por CLI (`scripts/create-admin.mjs`).
- **Security Rules:** `allow write: if false` en todas las colecciones de negocio. Un socio, un distribuidor o incluso el admin **no pueden escribir saldos ni transacciones desde el navegador**. Las pruebas lo verifican.
- **Aislamiento entre distribuidores:** las reglas solo devuelven transacciones con `distributorId == token.distributorId`. Los distribuidores no ven saldos ni datos de contacto de los socios; identifican al socio mediante una función que devuelve datos mínimos (nombre, código, identificación enmascarada).
- **Cálculo de puntos en el backend** con la regla vigente, que queda guardada en cada transacción. El frontend solo muestra una estimación; si envía `points`, se ignora.
- **Idempotencia:** el ID de la compra es `pur_{distribuidor}_{clave}`, y la clave se genera al abrir la pantalla de confirmación. Un doble toque, un reintento o una red inestable no acreditan dos veces.
- **Detección de duplicados:** misma compra (socio + distribuidor + monto) dentro de la ventana configurada → se exige confirmación explícita y la operación queda marcada `possible_duplicate` para que el admin la revise.
- **Operaciones atómicas:** compra, billetera, contadores y auditoría se escriben en una sola transacción de Firestore.
- **Canjes sin doble descuento:** al solicitar, los puntos quedan *reservados*. Al aprobar se verifica la transición `pending → approved` dentro de la transacción, así que los puntos se descuentan una única vez.
- **No se eliminan transacciones:** los errores se corrigen con un *reverso* (admin + justificación) o un *ajuste* (admin + justificación obligatoria de 10 caracteres o más). Ninguna corrección deja saldo negativo.
- **Cuentas desactivadas:** el usuario de Auth queda deshabilitado, se revocan sus sesiones y las funciones validan el estado del documento.
- **QR personal:** contiene solo `RPA1:<token opaco>`, sin saldo ni datos personales.
- Validación de cédula/RUC ecuatoriano (dígito verificador), teléfonos 09XXXXXXXX y montos mínimo/máximo.
- Cabeceras de seguridad en Hosting. App Check opcional (recomendado en producción para el registro público).

## 4. Funcionalidades por rol (todas conectadas al backend real)

**Administrador:** dashboard en tiempo real (distribuidores activos, afiliados, puntos generados / canjeados / en circulación, compras, canjes pendientes, alertas), evolución mensual filtrable por distribuidor (6 o 12 meses), ranking por puntos / afiliados / ventas. Crea, edita, activa y desactiva distribuidores y sus cuentas. Restablece contraseñas. Busca afiliados por nombre, teléfono, identificación, código o escaneando su QR, con su saldo y su historial. Ajusta puntos con justificación. Tiene transacciones con filtros (fecha, distribuidor, afiliado, tipo, estado), detalle de quién registró cada operación y reversos. Gestiona recompensas (con subida de imágenes) y la cola de canjes (aprobar, rechazar, entregar). Configura las reglas y equivalencias. En *Control y auditoría* revisa duplicados, ejecuta la verificación de consistencia y consulta la bitácora. Exporta a CSV compatible con Excel (distribuidores, afiliados, transacciones, auditoría).

**Distribuidor:** botón principal "Registrar compra" → escanea el QR (o escribe el código / busca) → teclado numérico → confirmación con los puntos → acreditación inmediata. Además: estadísticas propias, historial con filtros y CSV, estado de cada transacción, búsqueda de afiliados, número de vinculados y su QR de registro para descargar o compartir.

**Socio:** registro desde el QR de un distribuidor o desde `/registro`. Inicia sesión con su cédula o pasaporte. Su pantalla principal es una tarjeta tipo wallet (saldo grande, código, botones *Mostrar mi QR* y *Ver recompensas*, últimos movimientos y estado de canjes). Puede ver su QR en pantalla completa (mantiene la pantalla encendida), descargarlo o compartirlo como imagen. Consulta su historial con fecha, distribuidor, monto y puntos, el catálogo con su progreso hacia cada premio, solicita y cancela canjes, edita su teléfono y correo, y cambia su contraseña.

## 5. Desarrollo local (sin cuenta de Google, con emuladores)

Requisitos: Node 22 y Java 21 (para el emulador de Firestore).

```bash
npm run install:all
```

```bash
npm run emulators
```

En otra terminal:

```bash
npm --prefix web run dev
```

Crea el admin en el emulador:

```bash
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/create-admin.mjs --project demo-red-puntos --email admin@demo.ec --password Admin12345 --name "Administrador"
```

Abre `http://127.0.0.1:5173` (en el emulador, usa 127.0.0.1 en lugar de localhost). La cámara requiere HTTPS en celulares reales; en desarrollo, prueba en la PC o usa el código manual.

## 6. Pruebas

```bash
npm test
```

- **Unitarias (17):** cálculo de puntos ($250.50 → 250), montos, cédula, QR, teléfonos, zona horaria.
- **Integración (16, emuladores reales):** creación de cuentas y roles, registro de socios, identificación por QR, compra idempotente, duplicados, montos inválidos, acumulación en varios distribuidores, reglas de lectura y escritura por rol, recompensas y canjes (reserva, aprobación única, rechazo, cancelación), ajustes, reversos, estadísticas y consistencia, distribuidor desactivado.
- **E2E de interfaz:** `node tests/e2e-ui.mjs` (con emuladores y Vite corriendo). Recorre el flujo completo en Chromium, incluido el **escaneo real del QR** con una cámara simulada.

## 7. Puesta en producción — qué necesitas configurar

1. **Proyecto Firebase** en <https://console.firebase.google.com>, con el **plan Blaze** (las Cloud Functions lo requieren; el uso bajo suele quedar dentro de la capa gratuita).
2. Activa **Authentication → Correo/contraseña**, **Firestore** (modo producción; región sugerida `us-east1` o `southamerica-east1`) y **Storage**.
3. Registra una **App web** y copia su configuración a `web/.env.local` (plantilla en `web/.env.example`).
4. La región de las funciones va en `functions/.env` (`FUNCTIONS_REGION=us-east1`) y tiene que coincidir con `VITE_FUNCTIONS_REGION`.
5. Pon el ID del proyecto en `.firebaserc` y despliega:

   ```bash
   npx firebase login
   ```

   ```bash
   npm run deploy
   ```

6. **Crea el administrador principal** con una cuenta de servicio (Consola → Configuración → Cuentas de servicio → Generar clave privada; no la subas al repositorio):

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/create-admin.mjs --project TU_PROYECTO --email tu@correo.ec --password 'ClaveSegura123' --name "Tu nombre"
   ```

7. Recomendado: **App Check** con reCAPTCHA Enterprise (`VITE_RECAPTCHA_SITE_KEY` en web y `ENFORCE_APP_CHECK=true` en `functions/.env`), un dominio propio en Hosting y una plantilla de correo de restablecimiento en español (Auth → Plantillas).

## 8. Decisiones y límites conocidos

- **Inicio de sesión de socios con cédula:** internamente se usa un correo sintético (`<cedula>@socios.redpuntos.app`), porque el correo es opcional para ellos. Si un socio olvida su contraseña, la restablece el admin. El login por SMS (Firebase Phone Auth) se puede agregar después; tiene costo por SMS.
- **Búsqueda por nombre:** es por prefijo y sin tildes ("mar" encuentra "María Pérez"). Para búsqueda de texto completo a gran escala se recomienda integrar Algolia o Typesense.
- **Contadores globales:** `stats/global` se actualiza en cada compra. Firestore admite aproximadamente 1 escritura por segundo sostenida por documento, suficiente para cientos de compras por minuto en ráfagas cortas. A gran volumen conviene usar contadores distribuidos (sharded counters).
- **Exportación:** CSV con BOM y separador `;`, que Excel en configuración regional es-EC abre directamente, hasta 10 000 filas por exportación con los filtros activos.
- **Notificaciones** (WhatsApp, correo o push al aprobar canjes) no están incluidas. El modelo permite agregarlas con un trigger sobre `redemptions`.
