<?php
/**
 * API de R3 Puntos. Rutas: POST /api/<funcion> con JSON {"data": {...}} y cabecera Authorization: Bearer <ID token de Firebase>.
 * Respuesta: {"result": ...} o {"error": {"status": "INVALID_ARGUMENT", "message": "...", "details": ...}}
 */
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
foreach (['affiliates', 'distributors', 'purchases', 'rewards', 'config'] as $m) require __DIR__ . "/fn/$m.php";

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const PUBLIC_FNS = ['registerAffiliate', 'resolveRegistrationCode'];
const ALL_FNS = ['registerAffiliate', 'resolveRegistrationCode', 'lookupAffiliate', 'searchAffiliates', 'updateMyProfile',
    'createDistributor', 'updateDistributor', 'setAccountStatus', 'resetUserPassword',
    'registerPurchase', 'reversePurchase', 'adjustPoints', 'runIntegrityCheck',
    'saveReward', 'requestRedemption', 'cancelRedemption', 'resolveRedemption', 'uploadRewardImage', 'updatePointsConfig'];

function respond(int $code, array $body): never
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond(405, ['error' => ['status' => 'INVALID_ARGUMENT', 'message' => 'Usa POST.']]);
    $route = $_GET['fn'] ?? basename(parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '');
    if (!in_array($route, ALL_FNS, true)) respond(404, ['error' => ['status' => 'NOT_FOUND', 'message' => 'Función no encontrada.']]);

    $authz = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(\S+)$/i', $authz, $m)) Ctx::$auth = IdToken::verify($m[1]);
    elseif (!in_array($route, PUBLIC_FNS, true)) fail('unauthenticated', 'Debes iniciar sesión.');

    if ($route === 'uploadRewardImage') respond(200, ['result' => fn_uploadRewardImage()]);
    $raw = file_get_contents('php://input') ?: '';
    if (strlen($raw) > 100000) fail('invalid-argument', 'Solicitud demasiado grande.');
    $body = json_decode($raw, true);
    $data = is_array($body['data'] ?? null) ? $body['data'] : [];
    respond(200, ['result' => ("fn_$route")($data)]);
} catch (ApiError $e) {
    respond(ApiError::HTTP[$e->codeName] ?? 500, ['error' => ['status' => strtoupper(str_replace('-', '_', $e->codeName)), 'message' => $e->getMessage(), 'details' => $e->details]]);
} catch (Throwable $e) {
    error_log('[r3-api] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    respond(500, ['error' => ['status' => 'INTERNAL', 'message' => 'Ocurrió un error inesperado. Intenta de nuevo.']]);
}
