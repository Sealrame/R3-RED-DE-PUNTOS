<?php
declare(strict_types=1);

/**
 * Registra una compra y acredita los puntos de forma atómica.
 * - Los puntos se calculan aquí con la regla vigente (nunca se confía en el navegador).
 * - Idempotente: el ID deriva de (distribuidor, idempotencyKey); un reintento devuelve la misma operación.
 * - Compras idénticas en la ventana configurada exigen confirmación y quedan marcadas para revisión.
 */
function fn_registerPurchase(array $d): array
{
    $actor = requireRole('distributor', 'admin');
    $affiliateId = doc_id_arg($d, 'affiliateId', 'Afiliado');
    $amountCents = int_arg($d, 'amountCents', 'Monto', 1, 100000000);
    $key = idempotency_arg($d);
    $reference = str_arg($d, 'reference', 'Referencia / factura', 1, 60, true) ?: null;
    $confirmDuplicate = ($d['confirmDuplicate'] ?? false) === true;
    $distributorId = $actor['role'] === 'admin' ? doc_id_arg($d, 'distributorId', 'Distribuidor') : (string) $actor['distributorId'];
    if (!$distributorId) fail('permission-denied', 'Cuenta de distribuidor sin asignación.');

    $txPath = COL_TX . "/pur_{$distributorId}_$key";
    $distPath = COL_DIST . "/$distributorId"; $affPath = COL_AFF . "/$affiliateId"; $walletPath = COL_WALLETS . "/$affiliateId";

    return Ctx::db()->runTransaction(function (Tx $tx) use ($txPath, $distPath, $affPath, $walletPath, $affiliateId, $amountCents, $key, $reference, $confirmDuplicate, $distributorId, $actor) {
        [$existing, $cfgDoc, $dist, $aff, $wallet] = $tx->getAll([$txPath, COL_CONFIG . '/points', $distPath, $affPath, $walletPath]);
        if ($existing->exists()) {
            if ($existing->get('affiliateId') !== $affiliateId || $existing->get('amountCents') !== $amountCents) fail('already-exists', 'Clave de operación reutilizada con datos distintos.');
            return ['transactionId' => $existing->id(), 'points' => $existing->get('points'), 'balanceAfter' => $existing->get('balanceAfter'), 'replayed' => true, 'flags' => $existing->get('flags', [])];
        }
        $cfg = Domain::DEFAULT_CONFIG;
        foreach (($cfgDoc->data ?? []) as $k => $v) if (array_key_exists($k, $cfg)) $cfg[$k] = $v;
        if (!$dist->exists() || $dist->get('status') !== 'active') fail('permission-denied', 'El distribuidor no está activo.');
        if (!$aff->exists()) fail('not-found', 'Afiliado no encontrado.');
        if ($aff->get('status') !== 'active') fail('failed-precondition', 'El afiliado está inactivo y no puede acumular puntos.');
        if (!$wallet->exists()) fail('internal', 'Billetera de puntos no encontrada.');
        if ($err = Domain::validatePurchaseAmount($amountCents, $cfg)) fail('invalid-argument', $err);
        $points = Domain::calculatePoints($amountCents, $cfg);

        $flags = [];
        $last = $wallet->get('lastPurchase');
        if (is_array($last) && ($last['distributorId'] ?? null) === $distributorId && ($last['amountCents'] ?? null) === $amountCents
            && isset($last['at']) && $last['at'] instanceof Ts && (microtime(true) * 1000 - $last['at']->unixMs()) < $cfg['duplicateWindowSeconds'] * 1000) {
            if (!$confirmDuplicate) fail('failed-precondition', 'Posible compra duplicada: ya se registró el mismo monto para este afiliado hace instantes.', ['reason' => 'possible-duplicate']);
            $flags[] = 'possible_duplicate';
        }
        $balanceAfter = (int) $wallet->get('balance') + $points;
        $linkNow = !$aff->get('distributorId');
        $tx->create($txPath, [
            'type' => 'purchase', 'status' => 'confirmed', 'affiliateId' => $affiliateId, 'affiliateUid' => $aff->get('uid'),
            'affiliateName' => $aff->get('fullName'), 'affiliateCode' => $aff->get('code'), 'distributorId' => $distributorId,
            'distributorName' => $dist->get('name'), 'amountCents' => $amountCents, 'points' => $points, 'balanceAfter' => $balanceAfter,
            'reference' => $reference, 'flags' => $flags, 'rule' => ['pointsPerDollar' => $cfg['pointsPerDollar'], 'rounding' => $cfg['rounding']],
            'createdBy' => $actor['uid'], 'createdByRole' => $actor['role'], 'idempotencyKey' => $key, 'createdAt' => FV::now(),
        ]);
        $tx->update($walletPath, [
            'balance' => FV::inc($points), 'totalEarned' => FV::inc($points),
            'lastPurchase' => ['distributorId' => $distributorId, 'amountCents' => $amountCents, 'at' => Ts::now()], 'updatedAt' => FV::now(),
        ]);
        if ($linkNow) $tx->update($affPath, ['distributorId' => $distributorId, 'distributorName' => $dist->get('name'), 'updatedAt' => FV::now()]);
        $tx->update($distPath, ['purchaseCount' => FV::inc(1), 'pointsGenerated' => FV::inc($points), 'salesCents' => FV::inc($amountCents), 'lastPurchaseAt' => FV::now()]
            + ($linkNow ? ['affiliateCount' => FV::inc(1)] : []));
        bump_stats($tx,
            ['purchases' => 1, 'salesCents' => $amountCents, 'pointsGenerated' => $points, 'pointsInCirculation' => $points] + ($flags ? ['flagged' => 1] : []),
            ['purchases' => 1, 'salesCents' => $amountCents, 'pointsGenerated' => $points],
            $distributorId, ['purchases' => 1, 'salesCents' => $amountCents, 'pointsGenerated' => $points]);
        audit($tx, $actor, 'purchase.register', 'transaction', basename($txPath), ['affiliateId' => $affiliateId, 'distributorId' => $distributorId, 'amountCents' => $amountCents, 'points' => $points, 'flags' => $flags]);
        return ['transactionId' => basename($txPath), 'points' => $points, 'balanceAfter' => $balanceAfter, 'replayed' => false, 'flags' => $flags];
    });
}

function available_points(Doc $w): int { return (int) $w->get('balance', 0) - (int) $w->get('reserved', 0); }

/** Admin revierte una compra confirmada: no se borra, se crea un movimiento de reverso. */
function fn_reversePurchase(array $d): array
{
    $actor = requireRole('admin');
    $id = doc_id_arg($d, 'transactionId', 'Transacción');
    $reason = str_arg($d, 'reason', 'Justificación', 10, 500);
    return Ctx::db()->runTransaction(function (Tx $tx) use ($id, $reason, $actor) {
        $t = $tx->get(COL_TX . "/$id");
        if (!$t->exists() || $t->get('type') !== 'purchase') fail('not-found', 'Compra no encontrada.');
        if ($t->get('status') !== 'confirmed') fail('failed-precondition', 'La compra ya fue revertida.');
        $p = $t->data;
        $walletPath = COL_WALLETS . '/' . $p['affiliateId'];
        $w = $tx->get($walletPath);
        $available = available_points($w);
        if ($available - $p['points'] < 0) fail('failed-precondition', "Saldo disponible insuficiente ($available pts).");
        $revId = "rev_$id";
        $tx->update(COL_TX . "/$id", ['status' => 'reversed', 'reversedAt' => FV::now(), 'reversedBy' => $actor['uid'], 'reversalId' => $revId, 'reversalReason' => $reason]);
        $tx->create(COL_TX . "/$revId", [
            'type' => 'reversal', 'status' => 'confirmed', 'affiliateId' => $p['affiliateId'], 'affiliateUid' => $p['affiliateUid'],
            'affiliateName' => $p['affiliateName'], 'affiliateCode' => $p['affiliateCode'], 'distributorId' => $p['distributorId'], 'distributorName' => $p['distributorName'],
            'amountCents' => -$p['amountCents'], 'points' => -$p['points'], 'balanceAfter' => (int) $w->get('balance') - $p['points'],
            'reason' => $reason, 'originalTransactionId' => $id, 'flags' => [], 'createdBy' => $actor['uid'], 'createdByRole' => 'admin', 'createdAt' => FV::now(),
        ]);
        $tx->update($walletPath, ['balance' => FV::inc(-$p['points']), 'totalEarned' => FV::inc(-$p['points']), 'updatedAt' => FV::now()]);
        $tx->update(COL_DIST . '/' . $p['distributorId'], [
            'purchaseCount' => FV::inc(-1), 'pointsGenerated' => FV::inc(-$p['points']), 'salesCents' => FV::inc(-$p['amountCents']), 'reversalCount' => FV::inc(1),
        ]);
        bump_stats($tx, ['purchases' => -1, 'salesCents' => -$p['amountCents'], 'pointsGenerated' => -$p['points'], 'pointsInCirculation' => -$p['points'], 'reversals' => 1]
            + (!empty($p['flags']) ? ['flagged' => -1] : []));
        audit($tx, $actor, 'purchase.reverse', 'transaction', $id, ['reason' => $reason, 'points' => $p['points'], 'affiliateId' => $p['affiliateId']]);
        return ['reversalId' => $revId];
    });
}

/** Admin ajusta puntos manualmente con justificación obligatoria. */
function fn_adjustPoints(array $d): array
{
    $actor = requireRole('admin');
    $affiliateId = doc_id_arg($d, 'affiliateId', 'Afiliado');
    $delta = int_arg($d, 'delta', 'Puntos', -1000000, 1000000);
    if ($delta === 0) fail('invalid-argument', 'El ajuste no puede ser 0.');
    $reason = str_arg($d, 'reason', 'Justificación', 10, 500);
    $key = idempotency_arg($d);
    $path = COL_TX . "/adj_$key";
    return Ctx::db()->runTransaction(function (Tx $tx) use ($path, $affiliateId, $delta, $reason, $key, $actor) {
        [$existing, $aff, $w] = $tx->getAll([$path, COL_AFF . "/$affiliateId", COL_WALLETS . "/$affiliateId"]);
        if ($existing->exists()) return ['transactionId' => $existing->id(), 'replayed' => true];
        if (!$aff->exists()) fail('not-found', 'Afiliado no encontrado.');
        $available = available_points($w);
        if ($available + $delta < 0) fail('failed-precondition', "Saldo disponible insuficiente ($available pts).");
        $tx->create($path, [
            'type' => 'adjustment', 'status' => 'confirmed', 'affiliateId' => $affiliateId, 'affiliateUid' => $aff->get('uid'), 'affiliateName' => $aff->get('fullName'),
            'affiliateCode' => $aff->get('code'), 'distributorId' => null, 'distributorName' => null, 'amountCents' => 0, 'points' => $delta,
            'balanceAfter' => (int) $w->get('balance') + $delta, 'reason' => $reason, 'flags' => [], 'createdBy' => $actor['uid'], 'createdByRole' => 'admin',
            'idempotencyKey' => $key, 'createdAt' => FV::now(),
        ]);
        $tx->update(COL_WALLETS . "/$affiliateId", ['balance' => FV::inc($delta), 'totalAdjusted' => FV::inc($delta), 'updatedAt' => FV::now()]);
        bump_stats($tx, ['pointsAdjusted' => $delta, 'pointsInCirculation' => $delta, 'adjustments' => 1]);
        audit($tx, $actor, 'points.adjust', 'affiliate', $affiliateId, ['delta' => $delta, 'reason' => $reason, 'transactionId' => basename($path)]);
        return ['transactionId' => basename($path), 'replayed' => false];
    });
}

/** Consistencia: saldo = Σ puntos de movimientos; reservado = Σ canjes pendientes. Procesa 100 billeteras por llamada. */
function fn_runIntegrityCheck(array $d): array
{
    $actor = requireRole('admin');
    $db = Ctx::db();
    $q = ['from' => COL_WALLETS, 'orderBy' => [['__name__', 'asc']], 'limit' => 100];
    if (is_string($d['after'] ?? null) && preg_match('/^[A-Za-z0-9_-]+$/', $d['after'])) $q['startAfter'] = COL_WALLETS . '/' . $d['after'];
    $wallets = $db->query($q);
    $issues = [];
    foreach ($wallets as $w) {
        $sum = 0; foreach ($db->query(['from' => COL_TX, 'where' => [['affiliateId', '==', $w->id()]], 'select' => ['points']]) as $t) $sum += (int) $t->get('points');
        $res = 0; foreach ($db->query(['from' => COL_RED, 'where' => [['affiliateId', '==', $w->id()], ['status', '==', 'pending']], 'select' => ['pointsCost']]) as $r) $res += (int) $r->get('pointsCost');
        if ($sum !== (int) $w->get('balance') || $res !== (int) $w->get('reserved', 0))
            $issues[] = ['affiliateId' => $w->id(), 'balance' => (int) $w->get('balance'), 'expectedBalance' => $sum, 'reserved' => (int) $w->get('reserved', 0), 'expectedReserved' => $res];
    }
    $db->runTransaction(function (Tx $tx) use ($actor, $wallets, $issues) { audit($tx, $actor, 'integrity.check', 'system', 'wallets', ['scanned' => count($wallets), 'issues' => count($issues)]); });
    return ['scanned' => count($wallets), 'issues' => $issues, 'next' => count($wallets) === 100 ? end($wallets)->id() : null];
}
