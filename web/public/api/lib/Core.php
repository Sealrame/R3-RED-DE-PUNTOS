<?php
declare(strict_types=1);

final class Ctx
{
    public static ?Firestore $db = null;
    public static ?array $auth = null; // claims del ID token
    public static function db(): Firestore { return self::$db ??= new Firestore(); }
}

const COL_USERS = 'users', COL_DIST = 'distributors', COL_AFF = 'affiliates', COL_WALLETS = 'points_wallets',
    COL_TX = 'transactions', COL_REWARDS = 'rewards', COL_RED = 'redemptions', COL_AUDIT = 'audit_logs',
    COL_REGISTRY = 'registry', COL_CONFIG = 'config', COL_STATS = 'stats', COL_STATS_M = 'stats_monthly';

/** Exige sesión válida, uno de los roles indicados (custom claims) y cuenta activa. */
function requireRole(string ...$roles): array
{
    $c = Ctx::$auth;
    if (!$c) fail('unauthenticated', 'Debes iniciar sesión.');
    $role = $c['role'] ?? null;
    if (!$role || !in_array($role, $roles, true)) fail('permission-denied', 'No tienes permisos para esta operación.');
    $u = Ctx::db()->get(COL_USERS . '/' . $c['sub']);
    if ($u->exists() && $u->get('status') === 'inactive') fail('permission-denied', 'Tu cuenta está desactivada.');
    return ['uid' => $c['sub'], 'role' => $role, 'distributorId' => $c['distributorId'] ?? null, 'affiliateId' => $c['affiliateId'] ?? null];
}

function str_arg(array $d, string $key, string $label, int $min = 1, int $max = 200, bool $optional = false): string
{
    $v = $d[$key] ?? null;
    if ($v === null || $v === '') { if ($optional) return ''; fail('invalid-argument', "El campo \"$label\" es obligatorio."); }
    if (!is_string($v)) fail('invalid-argument', "El campo \"$label\" no es válido.");
    $s = trim($v);
    $len = function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : (int) preg_match_all('/./us', $s);
    if ($len < $min || $len > $max) fail('invalid-argument', "El campo \"$label\" debe tener entre $min y $max caracteres.");
    return $s;
}

function int_arg(array $d, string $key, string $label, int $min = PHP_INT_MIN, int $max = PHP_INT_MAX): int
{
    $v = $d[$key] ?? null;
    if (!is_int($v) || $v < $min || $v > $max) fail('invalid-argument', "El campo \"$label\" debe ser un número entero válido.");
    return $v;
}

function idempotency_arg(array $d): string
{
    $v = $d['idempotencyKey'] ?? null;
    if (!is_string($v) || !preg_match('/^[A-Za-z0-9-]{16,64}$/', $v)) fail('invalid-argument', 'Clave de idempotencia inválida.');
    return $v;
}

function valid_email(string $e): bool { return (bool) preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/', $e); }
function doc_id_arg(array $d, string $key, string $label): string
{
    $s = str_arg($d, $key, $label, 1, 160);
    if (!preg_match('/^[A-Za-z0-9_-]+$/', $s)) fail('invalid-argument', "El campo \"$label\" no es válido.");
    return $s;
}

function points_config(?Tx $tx = null): array
{
    $doc = $tx ? $tx->get(COL_CONFIG . '/points') : Ctx::db()->get(COL_CONFIG . '/points');
    $cfg = Domain::DEFAULT_CONFIG;
    foreach (($doc->data ?? []) as $k => $v) if (array_key_exists($k, $cfg)) $cfg[$k] = $v;
    return $cfg;
}

function audit(Tx $tx, array $actor, string $action, string $type, string $id, array $data = []): void
{
    $tx->set(COL_AUDIT . '/' . Domain::randomId(), [
        'action' => $action, 'actorUid' => $actor['uid'], 'actorRole' => $actor['role'], 'targetType' => $type, 'targetId' => $id,
        'data' => $data, 'createdAt' => FV::now(),
    ]);
}

/** Contadores agregados (global, mensual de la red y mensual del distribuidor), en la misma transacción. */
function bump_stats(Tx $tx, array $global, ?array $monthly = null, ?string $distributorId = null, ?array $distMonthly = null): void
{
    $inc = fn(array $o) => array_map(fn($v) => FV::inc($v), $o);
    $ym = Domain::monthKey();
    if ($global) $tx->merge(COL_STATS . '/global', $inc($global) + ['updatedAt' => FV::now()]);
    if ($monthly) $tx->merge(COL_STATS_M . "/$ym", $inc($monthly) + ['month' => $ym]);
    if ($distributorId && $distMonthly) $tx->merge(COL_DIST . "/$distributorId/monthly/$ym", $inc($distMonthly) + ['month' => $ym]);
}

function registry_path(string $key): string { return COL_REGISTRY . '/' . str_replace('/', '_', $key); }

function unique_code(Tx $tx, string $prefix, int $len): string
{
    for ($i = 0; $i < 8; $i++) {
        $code = "$prefix-" . Domain::randomCode($len);
        if (!$tx->get(registry_path("code:$code"))->exists()) return $code;
    }
    fail('internal', 'No se pudo generar un código único. Intenta de nuevo.');
}

function mask_id(string $id): string
{
    return strlen($id) <= 4 ? $id : str_repeat('•', strlen($id) - 4) . substr($id, -4);
}

/** Límite simple por IP para endpoints públicos (archivo en la carpeta privada). */
function rate_limit(string $bucket, int $max, int $windowSec): void
{
    if (getenv('R3_DISABLE_RATE_LIMIT') === '1') return;
    $ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? 'cli';
    $file = Config::get()['cacheDir'] . '/rl-' . $bucket . '-' . sha1($ip) . '.json';
    $now = time();
    $fh = @fopen($file, 'c+');
    if (!$fh) return;
    flock($fh, LOCK_EX);
    $hits = array_filter(json_decode((string) stream_get_contents($fh), true) ?: [], fn($t) => $t > $now - $windowSec);
    if (count($hits) >= $max) { flock($fh, LOCK_UN); fclose($fh); fail('resource-exhausted', 'Demasiados intentos. Espera unos minutos.'); }
    $hits[] = $now;
    ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode(array_values($hits)));
    flock($fh, LOCK_UN); fclose($fh);
}
