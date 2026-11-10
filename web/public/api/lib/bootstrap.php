<?php
/**
 * Arranque del API de R3 Puntos para Hostinger (PHP 8.1+, extensiones curl y openssl).
 *
 * Configuración (en este orden):
 *  1. Variables de entorno (usadas en pruebas con emuladores).
 *  2. Archivo privado config.php en la carpeta r3-private, FUERA de public_html:
 *       domains/r3reddetalleres.com/r3-private/config.php
 *       domains/r3reddetalleres.com/r3-private/service-account.json
 */
declare(strict_types=1);

require_once __DIR__ . '/Domain.php';
require_once __DIR__ . '/Http.php';
require_once __DIR__ . '/Firestore.php';
require_once __DIR__ . '/AuthAdmin.php';
require_once __DIR__ . '/Core.php';

final class ApiError extends Exception
{
    public const HTTP = [
        'invalid-argument' => 400, 'failed-precondition' => 400, 'out-of-range' => 400, 'unauthenticated' => 401,
        'permission-denied' => 403, 'not-found' => 404, 'already-exists' => 409, 'aborted' => 409,
        'resource-exhausted' => 429, 'internal' => 500, 'unavailable' => 503,
    ];
    public function __construct(public readonly string $codeName, string $message, public readonly mixed $details = null)
    {
        parent::__construct($message);
    }
}

function fail(string $code, string $message, mixed $details = null): never
{
    throw new ApiError($code, $message, $details);
}

final class Config
{
    private static ?array $cfg = null;

    public static function privateDir(): string
    {
        $env = getenv('R3_PRIVATE_DIR');
        if ($env) return rtrim($env, '/');
        // Siempre FUERA de public_html: …/domains/<dominio>/r3-private (sirve también si la app está en un subdominio o subcarpeta)
        $dir = str_replace('\\', '/', __DIR__);
        $pos = strrpos($dir, '/public_html/');
        if ($pos !== false) return substr($dir, 0, $pos) . '/r3-private';
        return dirname(__DIR__, 3) . '/r3-private';
    }

    public static function get(): array
    {
        if (self::$cfg !== null) return self::$cfg;
        $file = self::privateDir() . '/config.php';
        $local = is_file($file) ? (require $file) : [];
        $saPath = getenv('R3_SERVICE_ACCOUNT') ?: ($local['serviceAccountFile'] ?? self::privateDir() . '/service-account.json');
        $sa = is_file($saPath) ? json_decode((string) file_get_contents($saPath), true) : null;
        $projectId = getenv('R3_PROJECT_ID') ?: ($local['projectId'] ?? ($sa['project_id'] ?? null));
        self::$cfg = [
            'projectId' => $projectId,
            'serviceAccount' => $sa,
            'firestoreEmulator' => getenv('FIRESTORE_EMULATOR_HOST') ?: null,
            'authEmulator' => getenv('FIREBASE_AUTH_EMULATOR_HOST') ?: null,
            'publicBaseUrl' => $local['publicBaseUrl'] ?? null,
            'uploadsDir' => getenv('R3_UPLOADS_DIR') ?: ($local['uploadsDir'] ?? dirname(__DIR__, 2) . '/uploads'),
            'cacheDir' => self::cacheDir(),
        ];
        if (!self::$cfg['projectId']) fail('internal', 'Servidor sin configurar: falta el projectId o la cuenta de servicio de Firebase.');
        if (!self::$cfg['serviceAccount'] && !self::$cfg['firestoreEmulator'])
            fail('internal', 'Servidor sin configurar: falta el archivo service-account.json en la carpeta privada.');
        return self::$cfg;
    }

    private static function cacheDir(): string
    {
        $d = self::privateDir() . '/cache';
        if (!is_dir($d)) @mkdir($d, 0700, true);
        if (!is_dir($d) || !is_writable($d)) {
            $d = sys_get_temp_dir() . '/r3-cache-' . substr(sha1(__DIR__), 0, 8);
            if (!is_dir($d)) @mkdir($d, 0700, true);
        }
        return $d;
    }
}

/** Token OAuth de la cuenta de servicio (JWT RS256), con caché en disco ~55 min. */
final class GoogleAuth
{
    public static function accessToken(): string
    {
        $cfg = Config::get();
        $sa = $cfg['serviceAccount'];
        if (!$sa) return 'owner'; // emuladores
        $cache = $cfg['cacheDir'] . '/oauth-' . substr(sha1($sa['client_email']), 0, 10) . '.json';
        if (is_file($cache)) {
            $c = json_decode((string) file_get_contents($cache), true);
            if (($c['exp'] ?? 0) > time() + 120) return $c['token'];
        }
        $now = time();
        $b64 = fn(string $s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
        $head = $b64(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
        $claims = $b64(json_encode([
            'iss' => $sa['client_email'], 'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600,
            'scope' => 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase',
        ]));
        $sig = '';
        if (!openssl_sign("$head.$claims", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256)) fail('internal', 'No se pudo firmar la credencial del servidor.');
        $r = Http::request('POST', 'https://oauth2.googleapis.com/token', [
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => "$head.$claims." . $b64($sig),
        ], [], true);
        if ($r['status'] !== 200 || empty($r['json']['access_token'])) fail('internal', 'No se pudo autenticar el servidor con Google.');
        @file_put_contents($cache, json_encode(['token' => $r['json']['access_token'], 'exp' => $now + (int) $r['json']['expires_in']]), LOCK_EX);
        @chmod($cache, 0600);
        return $r['json']['access_token'];
    }
}
