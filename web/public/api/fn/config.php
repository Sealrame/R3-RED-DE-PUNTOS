<?php
declare(strict_types=1);

/** Admin actualiza las reglas de acumulación (auditado con valores anteriores y nuevos). */
function fn_updatePointsConfig(array $d): array
{
    $actor = requireRole('admin');
    $ppd = $d['pointsPerDollar'] ?? null;
    if (!is_int($ppd) && !is_float($ppd)) fail('invalid-argument', 'Puntos por dólar inválido.');
    if (!($ppd > 0 && $ppd <= 100) || abs(round($ppd * 100) - $ppd * 100) > 1e-9) fail('invalid-argument', 'Puntos por dólar debe ser un número entre 0.01 y 100 (máx. 2 decimales).');
    $rounding = $d['rounding'] ?? '';
    if (!in_array($rounding, ['floor', 'round', 'ceil'], true)) fail('invalid-argument', 'Redondeo inválido.');
    $pv = $d['pointValueUsd'] ?? null;
    if ((!is_int($pv) && !is_float($pv)) || $pv < 0 || $pv > 100) fail('invalid-argument', 'Valor del punto inválido.');
    $next = [
        'pointsPerDollar' => is_float($ppd) && floor($ppd) == $ppd ? (int) $ppd : $ppd,
        'rounding' => $rounding,
        'minPurchaseCents' => int_arg($d, 'minPurchaseCents', 'Compra mínima', 1, 100000000),
        'maxPurchaseCents' => int_arg($d, 'maxPurchaseCents', 'Compra máxima', 1, 100000000),
        'duplicateWindowSeconds' => int_arg($d, 'duplicateWindowSeconds', 'Ventana de duplicados', 0, 86400),
        'pointValueUsd' => (float) $pv,
        'requireDistributorOnSignup' => ($d['requireDistributorOnSignup'] ?? false) === true,
    ];
    if ($next['minPurchaseCents'] > $next['maxPurchaseCents']) fail('invalid-argument', 'La compra mínima no puede superar la máxima.');
    Ctx::db()->runTransaction(function (Tx $tx) use ($next, $actor) {
        $before = points_config($tx);
        $tx->set(COL_CONFIG . '/points', $next + ['updatedAt' => FV::now(), 'updatedBy' => $actor['uid']]);
        audit($tx, $actor, 'config.points.update', 'config', 'points', ['before' => $before, 'after' => $next]);
    });
    return ['ok' => true];
}
