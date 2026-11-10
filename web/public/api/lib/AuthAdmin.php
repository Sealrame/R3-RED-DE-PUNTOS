<?php
/**
 * Administración de cuentas de Firebase Authentication (Identity Toolkit REST) y verificación de ID tokens.
 */
declare(strict_types=1);

final class AuthAdmin
{
    private static function base(): string
    {
        $cfg = Config::get();
        $host = $cfg['authEmulator'] ? 'http://' . $cfg['authEmulator'] . '/identitytoolkit.googleapis.com' : 'https://identitytoolkit.googleapis.com';
        return "$host/v1/projects/{$cfg['projectId']}";
    }

    private static function call(string $suffix, array $body): array
    {
        $r = Http::request('POST', self::base() . $suffix, $body, ['Authorization' => 'Bearer ' . GoogleAuth::accessToken()]);
        if ($r['status'] === 200) return $r['json'] ?? [];
        $msg = (string) ($r['json']['error']['message'] ?? '');
        if (str_starts_with($msg, 'EMAIL_EXISTS') || str_starts_with($msg, 'DUPLICATE_EMAIL')) fail('already-exists', 'Ya existe una cuenta con ese correo o identificación.');
        if (str_starts_with($msg, 'WEAK_PASSWORD')) fail('invalid-argument', 'La contraseña debe tener al menos 8 caracteres.');
        if (str_starts_with($msg, 'INVALID_EMAIL')) fail('invalid-argument', 'Correo inválido.');
        if (str_starts_with($msg, 'USER_NOT_FOUND')) fail('not-found', 'Cuenta de acceso no encontrada.');
        error_log('[auth] ' . $r['status'] . ' ' . substr($r['body'], 0, 400));
        fail('internal', 'Error de autenticación.');
    }

    public static function createUser(string $email, string $password, string $displayName): string
    {
        return self::call('/accounts', ['email' => $email, 'password' => $password, 'displayName' => $displayName])['localId'];
    }

    public static function setClaims(string $uid, array $claims): void
    {
        self::call('/accounts:update', ['localId' => $uid, 'customAttributes' => json_encode($claims)]);
    }

    public static function update(string $uid, array $fields): void
    {
        self::call('/accounts:update', ['localId' => $uid] + $fields);
    }

    /** Invalida todas las sesiones abiertas del usuario. */
    public static function revoke(string $uid): void
    {
        self::update($uid, ['validSince' => (string) time()]);
    }

    public static function delete(string $uid): void
    {
        try { self::call('/accounts:delete', ['localId' => $uid]); } catch (Throwable) {}
    }
}

final class IdToken
{
    /** Verifica el ID token de Firebase (RS256, emisor/audiencia del proyecto, vigencia). @return array claims */
    public static function verify(string $jwt): array
    {
        $cfg = Config::get();
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) fail('unauthenticated', 'Sesión inválida.');
        $dec = fn(string $s) => base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
        $head = json_decode((string) $dec($parts[0]), true);
        $claims = json_decode((string) $dec($parts[1]), true);
        if (!is_array($head) || !is_array($claims)) fail('unauthenticated', 'Sesión inválida.');

        if (!$cfg['authEmulator']) {
            if (($head['alg'] ?? '') !== 'RS256' || empty($head['kid'])) fail('unauthenticated', 'Sesión inválida.');
            $cert = self::publicKeys()[$head['kid']] ?? null;
            if (!$cert) { $cert = self::publicKeys(true)[$head['kid']] ?? null; }
            if (!$cert || openssl_verify("$parts[0].$parts[1]", (string) $dec($parts[2]), $cert, OPENSSL_ALGO_SHA256) !== 1)
                fail('unauthenticated', 'Sesión inválida.');
        }
        $now = time();
        if (($claims['aud'] ?? '') !== $cfg['projectId'] || ($claims['iss'] ?? '') !== 'https://securetoken.google.com/' . $cfg['projectId'])
            fail('unauthenticated', 'Sesión de otro proyecto.');
        if (($claims['exp'] ?? 0) < $now - 30 || ($claims['iat'] ?? PHP_INT_MAX) > $now + 300 || empty($claims['sub']))
            fail('unauthenticated', 'Tu sesión expiró. Vuelve a iniciar sesión.');
        return $claims;
    }

    private static function publicKeys(bool $refresh = false): array
    {
        $file = Config::get()['cacheDir'] . '/securetoken-keys.json';
        if (!$refresh && is_file($file)) {
            $c = json_decode((string) file_get_contents($file), true);
            if (($c['exp'] ?? 0) > time()) return $c['keys'];
        }
        $r = Http::request('GET', 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
        if ($r['status'] !== 200 || !is_array($r['json'])) fail('unavailable', 'No se pudo validar la sesión. Intenta de nuevo.');
        $maxAge = preg_match('/max-age=(\d+)/', $r['headers']['cache-control'] ?? '', $m) ? (int) $m[1] : 3600;
        @file_put_contents($file, json_encode(['keys' => $r['json'], 'exp' => time() + $maxAge]), LOCK_EX);
        return $r['json'];
    }
}
