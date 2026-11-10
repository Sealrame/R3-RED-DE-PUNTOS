<?php
// Router para el servidor embebido de PHP (solo pruebas/desarrollo): php -S 127.0.0.1:8000 -t web/public tests/php-router.php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/api/([A-Za-z]+)$#', $path, $m)) { $_GET['fn'] = $m[1]; require __DIR__ . '/../web/public/api/index.php'; return true; }
if (preg_match('#^/api/(lib|fn)/#', $path)) { http_response_code(403); return true; }
return false;
