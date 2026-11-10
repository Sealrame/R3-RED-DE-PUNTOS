#!/usr/bin/env bash
# Ejecuta el API PHP contra los emuladores y corre las pruebas de integración.
set -euo pipefail
cd "$(dirname "$0")/.."
export R3_PROJECT_ID=demo-red-puntos R3_DISABLE_RATE_LIMIT=1
export R3_PRIVATE_DIR="${R3_PRIVATE_DIR:-$(mktemp -d)}" R3_UPLOADS_DIR="${R3_PRIVATE_DIR}/uploads"
php -S 127.0.0.1:8000 -t web/public tests/php-router.php > "${R3_PRIVATE_DIR}/php.log" 2>&1 &
PHP_PID=$!
trap 'kill $PHP_PID 2>/dev/null || true' EXIT
sleep 1
node --test tests/flow.test.mjs
