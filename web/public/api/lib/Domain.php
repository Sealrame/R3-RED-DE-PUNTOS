<?php
/**
 * Reglas de negocio (equivalente PHP de functions/src/shared/domain.ts).
 * El servidor es la autoridad: el frontend solo muestra estimaciones.
 */
declare(strict_types=1);

final class Domain
{
    public const DEFAULT_CONFIG = [
        'pointsPerDollar' => 1,
        'rounding' => 'floor',
        'minPurchaseCents' => 100,
        'maxPurchaseCents' => 1000000,
        'duplicateWindowSeconds' => 120,
        'pointValueUsd' => 0.01,
        'requireDistributorOnSignup' => false,
    ];
    public const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    public const QR_PREFIX = 'RPA1:';
    public const AFFILIATE_EMAIL_DOMAIN = 'socios.redpuntos.app';

    /** Puntos de una compra en enteros: cents * ppd / 100, con el redondeo configurado ($250.50 → 250). */
    public static function calculatePoints(int $amountCents, array $cfg): int
    {
        if ($amountCents <= 0) return 0;
        $ppdScaled = (int) round(((float) $cfg['pointsPerDollar']) * 100);
        $num = $amountCents * $ppdScaled; // puntos * 10000
        switch ($cfg['rounding']) {
            case 'ceil': return intdiv($num + 9999, 10000);
            case 'round': return (int) floor(($num + 5000) / 10000);
            default: return intdiv($num, 10000);
        }
    }

    public static function formatUsd(int $cents): string
    {
        return '$' . number_format($cents / 100, 2, ',', '.');
    }

    public static function validatePurchaseAmount(int $cents, array $cfg): ?string
    {
        if ($cents <= 0) return 'El monto debe ser mayor a cero.';
        if ($cents < $cfg['minPurchaseCents']) return 'El monto mínimo es ' . self::formatUsd((int) $cfg['minPurchaseCents']) . '.';
        if ($cents > $cfg['maxPurchaseCents']) return 'El monto máximo por compra es ' . self::formatUsd((int) $cfg['maxPurchaseCents']) . '.';
        return null;
    }

    public static function isValidCedula(string $c): bool
    {
        if (!preg_match('/^\d{10}$/', $c)) return false;
        $prov = (int) substr($c, 0, 2);
        if (!(($prov >= 1 && $prov <= 24) || $prov === 30)) return false;
        if ((int) $c[2] >= 6) return false;
        $coefs = [2, 1, 2, 1, 2, 1, 2, 1, 2];
        $sum = 0;
        for ($i = 0; $i < 9; $i++) { $v = (int) $c[$i] * $coefs[$i]; if ($v >= 10) $v -= 9; $sum += $v; }
        return ((10 - ($sum % 10)) % 10) === (int) $c[9];
    }

    public static function isValidRuc(string $r): bool
    {
        if (!preg_match('/^\d{13}$/', $r)) return false;
        if (!str_ends_with($r, '001') && !preg_match('/^\d{10}00[1-9]$/', $r)) return false;
        $third = (int) $r[2];
        if ($third < 6) return self::isValidCedula(substr($r, 0, 10));
        return $third === 6 || $third === 9;
    }

    public static function validateIdNumber(string $type, string $id): bool
    {
        $v = strtoupper(trim($id));
        if ($type === 'cedula') return self::isValidCedula($v);
        if ($type === 'ruc') return self::isValidRuc($v);
        return (bool) preg_match('/^[A-Z0-9]{5,20}$/', $v);
    }

    /** Celular 09XXXXXXXX o fijo 0[2-7]XXXXXXX, acepta +593. */
    public static function normalizeEcPhone(string $phone): ?string
    {
        $p = preg_replace('/[\s\-().]/', '', $phone) ?? '';
        if (str_starts_with($p, '+593')) $p = '0' . substr($p, 4);
        elseif (str_starts_with($p, '593') && strlen($p) >= 11) $p = '0' . substr($p, 3);
        if (preg_match('/^09\d{8}$/', $p) || preg_match('/^0[2-7]\d{7}$/', $p)) return $p;
        return null;
    }

    /** Texto para búsqueda por prefijo: sin tildes, minúsculas. */
    public static function searchKey(string $text): string
    {
        $t = class_exists('Normalizer') ? \Normalizer::normalize($text, \Normalizer::FORM_D) : $text;
        $t = preg_replace('/\p{Mn}+/u', '', (string) $t) ?? '';
        $t = mb_strtolower($t, 'UTF-8');
        return trim(preg_replace('/\s+/u', ' ', $t) ?? '');
    }

    /** Ecuador continental UTC-5, sin horario de verano. */
    public static function monthKey(?int $ts = null): string
    {
        return gmdate('Y-m', ($ts ?? time()) - 5 * 3600);
    }

    /** @return array{qrToken?:string,code?:string}|null */
    public static function decodeAffiliateQr(string $content): ?array
    {
        $c = trim($content);
        if (str_starts_with($c, self::QR_PREFIX)) {
            $t = substr($c, strlen(self::QR_PREFIX));
            return preg_match('/^[A-Za-z0-9_-]{20,64}$/', $t) ? ['qrToken' => $t] : null;
        }
        if (preg_match('/^AF-?([2-9A-HJKMNP-Z]{7})$/', strtoupper($c), $m)) return ['code' => 'AF-' . $m[1]];
        return null;
    }

    public static function affiliateLoginEmail(string $idNumber): string
    {
        return strtolower(trim($idNumber)) . '@' . self::AFFILIATE_EMAIL_DOMAIN;
    }

    public static function randomCode(int $len): string
    {
        $a = self::CODE_ALPHABET; $s = '';
        for ($i = 0; $i < $len; $i++) $s .= $a[random_int(0, strlen($a) - 1)];
        return $s;
    }

    /** Token opaco de 192 bits (base64url, 32 caracteres) para el QR personal. */
    public static function randomToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    }

    public static function randomId(int $len = 20): string
    {
        $a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; $s = '';
        for ($i = 0; $i < $len; $i++) $s .= $a[random_int(0, 61)];
        return $s;
    }
}
