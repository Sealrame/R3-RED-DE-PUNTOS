<?php
declare(strict_types=1);

function distributor_fields(array $d): array
{
    $name = str_arg($d, 'name', 'Nombre comercial', 2, 120);
    $ruc = str_arg($d, 'ruc', 'RUC', 1, 13, true);
    if ($ruc && !Domain::isValidRuc($ruc)) fail('invalid-argument', 'RUC inválido.');
    $phoneRaw = str_arg($d, 'phone', 'Teléfono', 1, 20, true);
    $phone = $phoneRaw ? Domain::normalizeEcPhone($phoneRaw) : null;
    if ($phoneRaw && !$phone) fail('invalid-argument', 'Teléfono inválido.');
    $opt = fn(string $k, string $l, int $max) => str_arg($d, $k, $l, 1, $max, true) ?: null;
    return [
        'name' => $name, 'searchName' => Domain::searchKey($name), 'ruc' => $ruc ?: null,
        'contactName' => $opt('contactName', 'Contacto', 120), 'phone' => $phone, 'city' => $opt('city', 'Ciudad', 80),
        'province' => $opt('province', 'Provincia', 80), 'address' => $opt('address', 'Dirección', 200),
    ];
}

/** Admin crea un distribuidor y su cuenta de acceso (correo + contraseña). */
function fn_createDistributor(array $d): array
{
    $actor = requireRole('admin');
    $f = distributor_fields($d);
    $email = strtolower(str_arg($d, 'email', 'Correo de acceso', 3, 120));
    if (!valid_email($email)) fail('invalid-argument', 'Correo inválido.');
    $password = is_string($d['password'] ?? null) ? $d['password'] : '';
    if (strlen($password) < 8) fail('invalid-argument', 'La contraseña debe tener al menos 8 caracteres.');
    $id = Domain::randomId();
    $uid = AuthAdmin::createUser($email, $password, $f['name']);
    try {
        $out = Ctx::db()->runTransaction(function (Tx $tx) use ($id, $uid, $f, $email, $actor) {
            $code = unique_code($tx, 'D', 5);
            $tx->create(COL_DIST . "/$id", $f + [
                'email' => $email, 'ownerUid' => $uid, 'registrationCode' => $code, 'status' => 'active',
                'affiliateCount' => 0, 'purchaseCount' => 0, 'pointsGenerated' => 0, 'salesCents' => 0, 'reversalCount' => 0,
                'lastPurchaseAt' => null, 'createdAt' => FV::now(), 'updatedAt' => FV::now(), 'createdBy' => $actor['uid'],
            ]);
            $tx->set(COL_USERS . "/$uid", ['role' => 'distributor', 'distributorId' => $id, 'displayName' => $f['name'], 'email' => $email, 'status' => 'active', 'createdAt' => FV::now()]);
            $tx->create(registry_path("code:$code"), ['type' => 'distributor', 'distributorId' => $id]);
            bump_stats($tx, ['distributorsTotal' => 1, 'distributorsActive' => 1]);
            audit($tx, $actor, 'distributor.create', 'distributor', $id, ['name' => $f['name'], 'email' => $email]);
            return ['distributorId' => $id, 'registrationCode' => $code];
        });
        AuthAdmin::setClaims($uid, ['role' => 'distributor', 'distributorId' => $id]);
        return $out;
    } catch (Throwable $e) {
        AuthAdmin::delete($uid);
        throw $e;
    }
}

/** Admin edita datos del distribuidor (incluye el correo de acceso). */
function fn_updateDistributor(array $d): array
{
    $actor = requireRole('admin');
    $id = doc_id_arg($d, 'id', 'id');
    $f = distributor_fields($d);
    $email = strtolower(str_arg($d, 'email', 'Correo de acceso', 3, 120));
    if (!valid_email($email)) fail('invalid-argument', 'Correo inválido.');
    $db = Ctx::db();
    $before = $db->get(COL_DIST . "/$id");
    if (!$before->exists()) fail('not-found', 'Distribuidor no encontrado.');
    if ($before->get('email') !== $email) AuthAdmin::update($before->get('ownerUid'), ['email' => $email]);
    $db->runTransaction(function (Tx $tx) use ($id, $f, $email, $before, $actor) {
        $tx->update(COL_DIST . "/$id", $f + ['email' => $email, 'updatedAt' => FV::now()]);
        $tx->update(COL_USERS . '/' . $before->get('ownerUid'), ['displayName' => $f['name'], 'email' => $email]);
        $changed = [];
        foreach ($f + ['email' => $email] as $k => $v) if ($k !== 'searchName' && $before->get($k) !== $v) $changed[$k] = ['from' => $before->get($k), 'to' => $v];
        audit($tx, $actor, 'distributor.update', 'distributor', $id, ['changed' => $changed]);
    });
    return ['ok' => true];
}

function target_arg(array $d): array
{
    $t = $d['targetType'] ?? '';
    if ($t !== 'distributor' && $t !== 'affiliate') fail('invalid-argument', 'Tipo inválido.');
    return [$t, $t === 'distributor' ? COL_DIST : COL_AFF, $t === 'distributor' ? 'ownerUid' : 'uid'];
}

/** Activa / desactiva cuentas. Desactivar bloquea el ingreso y cierra sus sesiones. */
function fn_setAccountStatus(array $d): array
{
    $actor = requireRole('admin');
    [$type, $col, $uidField] = target_arg($d);
    $id = doc_id_arg($d, 'id', 'id');
    $status = $d['status'] ?? '';
    if ($status !== 'active' && $status !== 'inactive') fail('invalid-argument', 'Estado inválido.');
    $reason = str_arg($d, 'reason', 'Motivo', 5, 500);
    $uid = Ctx::db()->runTransaction(function (Tx $tx) use ($col, $id, $uidField, $status, $reason, $type, $actor) {
        $doc = $tx->get("$col/$id");
        if (!$doc->exists()) fail('not-found', 'Cuenta no encontrada.');
        $prev = $doc->get('status');
        $uid = $doc->get($uidField);
        if ($prev === $status) return $uid;
        $tx->update("$col/$id", ['status' => $status, 'statusReason' => $reason, 'updatedAt' => FV::now()]);
        $tx->update(COL_USERS . "/$uid", ['status' => $status]);
        if ($type === 'distributor') bump_stats($tx, ['distributorsActive' => $status === 'active' ? 1 : -1]);
        audit($tx, $actor, "$type.status", $type, $id, ['from' => $prev, 'to' => $status, 'reason' => $reason]);
        return $uid;
    });
    AuthAdmin::update($uid, ['disableUser' => $status === 'inactive']);
    if ($status === 'inactive') AuthAdmin::revoke($uid);
    return ['ok' => true];
}

/** Admin restablece la contraseña de un distribuidor o socio. */
function fn_resetUserPassword(array $d): array
{
    $actor = requireRole('admin');
    [$type, $col, $uidField] = target_arg($d);
    $id = doc_id_arg($d, 'id', 'id');
    $password = is_string($d['password'] ?? null) ? $d['password'] : '';
    if (strlen($password) < 8) fail('invalid-argument', 'La contraseña debe tener al menos 8 caracteres.');
    $doc = Ctx::db()->get("$col/$id");
    if (!$doc->exists()) fail('not-found', 'Cuenta no encontrada.');
    AuthAdmin::update($doc->get($uidField), ['password' => $password]);
    AuthAdmin::revoke($doc->get($uidField));
    Ctx::db()->runTransaction(function (Tx $tx) use ($actor, $type, $id) { audit($tx, $actor, "$type.resetPassword", $type, $id); });
    return ['ok' => true];
}
