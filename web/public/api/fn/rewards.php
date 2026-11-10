<?php
declare(strict_types=1);

/** Admin crea o edita una recompensa (la imagen se sube antes con uploadRewardImage). */
function fn_saveReward(array $d): array
{
    $actor = requireRole('admin');
    $id = ($d['id'] ?? null) ? doc_id_arg($d, 'id', 'id') : null;
    $stock = $d['stock'] ?? null;
    $data = [
        'name' => str_arg($d, 'name', 'Nombre', 2, 80),
        'description' => str_arg($d, 'description', 'Descripción', 1, 500, true),
        'pointsCost' => int_arg($d, 'pointsCost', 'Puntos necesarios', 1, 10000000),
        'imageUrl' => str_arg($d, 'imageUrl', 'Imagen', 1, 1000, true) ?: null,
        'imagePath' => str_arg($d, 'imagePath', 'Ruta imagen', 1, 300, true) ?: null,
        'stock' => $stock === null || $stock === '' ? null : int_arg($d, 'stock', 'Disponibilidad', 0, 1000000),
        'category' => str_arg($d, 'category', 'Categoría', 1, 40, true) ?: null,
        'active' => ($d['active'] ?? false) === true,
        'sortOrder' => is_int($d['sortOrder'] ?? null) ? $d['sortOrder'] : 0,
    ];
    if ($data['imageUrl'] && !preg_match('#^https?://#', $data['imageUrl'])) fail('invalid-argument', 'URL de imagen inválida.');
    $id ??= Domain::randomId();
    Ctx::db()->runTransaction(function (Tx $tx) use ($id, $data, $actor, $d) {
        $snap = $tx->get(COL_REWARDS . "/$id");
        if (!empty($d['id']) && !$snap->exists()) fail('not-found', 'Recompensa no encontrada.');
        $tx->merge(COL_REWARDS . "/$id", $data + ['updatedAt' => FV::now()] + ($snap->exists() ? [] : ['createdAt' => FV::now(), 'redeemedCount' => 0]));
        audit($tx, $actor, $snap->exists() ? 'reward.update' : 'reward.create', 'reward', $id, ['before' => $snap->data, 'after' => $data]);
    });
    return ['id' => $id];
}

/** El socio solicita un canje: los puntos quedan RESERVADOS hasta que se apruebe o rechace. */
function fn_requestRedemption(array $d): array
{
    $actor = requireRole('affiliate');
    $rewardId = doc_id_arg($d, 'rewardId', 'Recompensa');
    $key = idempotency_arg($d);
    $affId = (string) $actor['affiliateId'];
    $path = COL_RED . "/red_{$affId}_$key";
    return Ctx::db()->runTransaction(function (Tx $tx) use ($path, $rewardId, $affId, $actor) {
        [$existing, $reward, $wallet, $aff] = $tx->getAll([$path, COL_REWARDS . "/$rewardId", COL_WALLETS . "/$affId", COL_AFF . "/$affId"]);
        if ($existing->exists()) return ['redemptionId' => $existing->id(), 'replayed' => true];
        if (!$aff->exists() || $aff->get('status') !== 'active') fail('failed-precondition', 'Tu cuenta no está activa.');
        if (!$reward->exists() || $reward->get('active') !== true) fail('not-found', 'La recompensa no está disponible.');
        $stock = $reward->get('stock');
        if ($stock !== null && $stock <= 0) fail('failed-precondition', 'Recompensa agotada.');
        $cost = (int) $reward->get('pointsCost');
        $available = available_points($wallet);
        if ($available < $cost) fail('failed-precondition', "Puntos insuficientes. Disponibles: $available, necesarios: $cost.");
        $tx->create($path, [
            'affiliateId' => $affId, 'affiliateUid' => $actor['uid'], 'affiliateName' => $aff->get('fullName'), 'affiliateCode' => $aff->get('code'),
            'rewardId' => $rewardId, 'rewardName' => $reward->get('name'), 'rewardImageUrl' => $reward->get('imageUrl'), 'pointsCost' => $cost,
            'status' => 'pending', 'code' => null, 'requestedAt' => FV::now(), 'updatedAt' => FV::now(), 'history' => [],
        ]);
        $tx->update(COL_WALLETS . "/$affId", ['reserved' => FV::inc($cost), 'updatedAt' => FV::now()]);
        if ($stock !== null) $tx->update(COL_REWARDS . "/$rewardId", ['stock' => FV::inc(-1)]);
        bump_stats($tx, ['redemptionsPending' => 1]);
        audit($tx, $actor, 'redemption.request', 'redemption', basename($path), ['rewardId' => $rewardId, 'cost' => $cost]);
        return ['redemptionId' => basename($path), 'replayed' => false];
    });
}

function release_reservation(Tx $tx, Doc $r, Doc $reward): void
{
    $tx->update(COL_WALLETS . '/' . $r->get('affiliateId'), ['reserved' => FV::inc(-(int) $r->get('pointsCost')), 'updatedAt' => FV::now()]);
    if ($reward->exists() && $reward->get('stock') !== null) $tx->update($reward->path, ['stock' => FV::inc(1)]);
}

/** El socio cancela su solicitud pendiente: se liberan los puntos reservados. */
function fn_cancelRedemption(array $d): array
{
    $actor = requireRole('affiliate');
    $id = doc_id_arg($d, 'redemptionId', 'Canje');
    Ctx::db()->runTransaction(function (Tx $tx) use ($id, $actor) {
        $r = $tx->get(COL_RED . "/$id");
        if (!$r->exists() || $r->get('affiliateId') !== $actor['affiliateId']) fail('not-found', 'Canje no encontrado.');
        if ($r->get('status') !== 'pending') fail('failed-precondition', 'Solo puedes cancelar canjes pendientes.');
        $reward = $tx->get(COL_REWARDS . '/' . $r->get('rewardId'));
        release_reservation($tx, $r, $reward);
        $tx->update(COL_RED . "/$id", ['status' => 'cancelled', 'updatedAt' => FV::now(), 'resolvedBy' => $actor['uid']]);
        bump_stats($tx, ['redemptionsPending' => -1]);
        audit($tx, $actor, 'redemption.cancel', 'redemption', $id);
    });
    return ['ok' => true];
}

/**
 * Admin resuelve un canje (la transición de estado se verifica dentro de la transacción: no hay doble descuento).
 *  approve: pending → approved (descuenta, genera código y movimiento) · reject: pending → rejected · deliver: approved → delivered
 */
function fn_resolveRedemption(array $d): array
{
    $actor = requireRole('admin');
    $id = doc_id_arg($d, 'redemptionId', 'Canje');
    $action = $d['action'] ?? '';
    if (!in_array($action, ['approve', 'reject', 'deliver'], true)) fail('invalid-argument', 'Acción inválida.');
    $note = str_arg($d, 'note', 'Nota', 1, 500, true) ?: null;
    if ($action === 'reject' && !$note) fail('invalid-argument', 'Indica el motivo del rechazo.');
    return Ctx::db()->runTransaction(function (Tx $tx) use ($id, $action, $note, $actor) {
        $r = $tx->get(COL_RED . "/$id");
        if (!$r->exists()) fail('not-found', 'Canje no encontrado.');
        $status = $r->get('status');
        $hist = ['action' => $action, 'by' => $actor['uid'], 'note' => $note, 'at' => gmdate('c')];
        if ($action === 'deliver') {
            if ($status !== 'approved') fail('failed-precondition', 'Solo se pueden entregar canjes aprobados.');
            $tx->update(COL_RED . "/$id", ['status' => 'delivered', 'deliveredBy' => $actor['uid'], 'deliveredAt' => FV::now(), 'updatedAt' => FV::now(), 'history' => FV::union([$hist])]);
            audit($tx, $actor, 'redemption.deliver', 'redemption', $id, ['note' => $note]);
            return ['status' => 'delivered'];
        }
        if ($status !== 'pending') fail('failed-precondition', "El canje ya fue procesado ($status).");
        [$reward, $wallet] = $tx->getAll([COL_REWARDS . '/' . $r->get('rewardId'), COL_WALLETS . '/' . $r->get('affiliateId')]);
        if ($action === 'reject') {
            release_reservation($tx, $r, $reward);
            $tx->update(COL_RED . "/$id", ['status' => 'rejected', 'resolvedBy' => $actor['uid'], 'resolvedAt' => FV::now(), 'note' => $note, 'updatedAt' => FV::now(), 'history' => FV::union([$hist])]);
            bump_stats($tx, ['redemptionsPending' => -1]);
            audit($tx, $actor, 'redemption.reject', 'redemption', $id, ['note' => $note]);
            return ['status' => 'rejected'];
        }
        $cost = (int) $r->get('pointsCost');
        if ((int) $wallet->get('balance') < $cost) fail('failed-precondition', 'El afiliado ya no tiene saldo suficiente.');
        $code = 'CJ-' . Domain::randomCode(8);
        $txId = "rdm_$id";
        $tx->create(COL_TX . "/$txId", [
            'type' => 'redemption', 'status' => 'confirmed', 'affiliateId' => $r->get('affiliateId'), 'affiliateUid' => $r->get('affiliateUid'),
            'affiliateName' => $r->get('affiliateName'), 'affiliateCode' => $r->get('affiliateCode'), 'distributorId' => null, 'distributorName' => null,
            'amountCents' => 0, 'points' => -$cost, 'balanceAfter' => (int) $wallet->get('balance') - $cost, 'redemptionId' => $id,
            'rewardName' => $r->get('rewardName'), 'redemptionCode' => $code, 'flags' => [], 'createdBy' => $actor['uid'], 'createdByRole' => 'admin', 'createdAt' => FV::now(),
        ]);
        $tx->update($wallet->path, ['balance' => FV::inc(-$cost), 'reserved' => FV::inc(-$cost), 'totalRedeemed' => FV::inc($cost), 'updatedAt' => FV::now()]);
        $tx->update(COL_RED . "/$id", ['status' => 'approved', 'code' => $code, 'approvedBy' => $actor['uid'], 'approvedAt' => FV::now(), 'transactionId' => $txId, 'note' => $note, 'updatedAt' => FV::now(), 'history' => FV::union([$hist])]);
        if ($reward->exists()) $tx->update($reward->path, ['redeemedCount' => FV::inc(1)]);
        bump_stats($tx, ['redemptionsPending' => -1, 'redemptions' => 1, 'pointsRedeemed' => $cost, 'pointsInCirculation' => -$cost], ['pointsRedeemed' => $cost, 'redemptions' => 1]);
        audit($tx, $actor, 'redemption.approve', 'redemption', $id, ['code' => $code, 'cost' => $cost]);
        return ['status' => 'approved', 'code' => $code];
    });
}

/** Admin sube la imagen de una recompensa (multipart, campo "file"). Se guarda en public_html/uploads/rewards. */
function fn_uploadRewardImage(): array
{
    requireRole('admin');
    $f = $_FILES['file'] ?? null;
    if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) fail('invalid-argument', 'No se recibió la imagen.');
    if ($f['size'] > 3 * 1024 * 1024) fail('invalid-argument', 'La imagen debe pesar menos de 3 MB.');
    $info = @getimagesize($f['tmp_name']);
    $ext = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'][$info['mime'] ?? ''] ?? null;
    if (!$ext) fail('invalid-argument', 'Usa una imagen PNG, JPG o WEBP.');
    $dir = Config::get()['uploadsDir'] . '/rewards';
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) fail('internal', 'No se pudo crear la carpeta de imágenes.');
    $name = bin2hex(random_bytes(12)) . ".$ext";
    if (!move_uploaded_file($f['tmp_name'], "$dir/$name")) fail('internal', 'No se pudo guardar la imagen.');
    $base = Config::get()['publicBaseUrl'] ?: ((($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST']);
    return ['url' => rtrim($base, '/') . "/uploads/rewards/$name", 'path' => "uploads/rewards/$name"];
}
