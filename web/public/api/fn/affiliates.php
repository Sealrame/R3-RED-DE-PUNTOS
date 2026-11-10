<?php
declare(strict_types=1);

/** Registro público de socios (QR de registro o página /registro). */
function fn_registerAffiliate(array $d): array
{
    rate_limit('register', 10, 600);
    $db = Ctx::db();
    $fullName = str_arg($d, 'fullName', 'Nombre completo', 3, 120);
    $idType = $d['idType'] ?? '';
    if (!in_array($idType, ['cedula', 'ruc', 'pasaporte'], true)) fail('invalid-argument', 'Tipo de identificación inválido.');
    $idNumber = strtoupper(str_arg($d, 'idNumber', 'Número de identificación', 5, 20));
    if (!Domain::validateIdNumber($idType, $idNumber)) fail('invalid-argument', 'El número de identificación no es válido.');
    $phone = Domain::normalizeEcPhone(str_arg($d, 'phone', 'Teléfono', 7, 20));
    if (!$phone) fail('invalid-argument', 'Teléfono inválido. Usa el formato 09XXXXXXXX.');
    $email = strtolower(str_arg($d, 'email', 'Correo', 1, 120, true));
    if ($email && !valid_email($email)) fail('invalid-argument', 'Correo inválido.');
    $password = is_string($d['password'] ?? null) ? $d['password'] : '';
    if (strlen($password) < 8 || strlen($password) > 128) fail('invalid-argument', 'La contraseña debe tener al menos 8 caracteres.');
    $distCode = strtoupper(str_arg($d, 'distributorCode', 'Código de distribuidor', 1, 20, true));
    if (($d['acceptTerms'] ?? null) !== true) fail('invalid-argument', 'Debes aceptar los términos y la política de privacidad.');

    $cfg = points_config();
    $dist = null;
    if ($distCode) {
        $q = $db->query(['from' => COL_DIST, 'where' => [['registrationCode', '==', $distCode]], 'limit' => 1]);
        if (!$q || $q[0]->get('status') !== 'active') fail('not-found', 'El código de distribuidor no es válido o está inactivo.');
        $dist = ['id' => $q[0]->id(), 'name' => $q[0]->get('name')];
    } elseif ($cfg['requireDistributorOnSignup']) {
        fail('failed-precondition', 'El registro requiere el QR o código de un distribuidor.');
    }
    $idKey = "id:$idType:$idNumber";
    if ($db->get(registry_path($idKey))->exists()) fail('already-exists', 'Ya existe un afiliado con esa identificación.');

    $affId = Domain::randomId();
    $loginEmail = Domain::affiliateLoginEmail($idNumber);
    $uid = AuthAdmin::createUser($loginEmail, $password, $fullName);
    try {
        $res = $db->runTransaction(function (Tx $tx) use ($idKey, $uid, $affId, $fullName, $idType, $idNumber, $phone, $email, $dist) {
            if ($tx->get(registry_path($idKey))->exists()) fail('already-exists', 'Ya existe un afiliado con esa identificación.');
            $code = unique_code($tx, 'AF', 7);
            $tx->create(COL_AFF . "/$affId", [
                'uid' => $uid, 'fullName' => $fullName, 'searchName' => Domain::searchKey($fullName), 'idType' => $idType, 'idNumber' => $idNumber,
                'phone' => $phone, 'email' => $email ?: null, 'code' => $code, 'qrToken' => Domain::randomToken(),
                'distributorId' => $dist['id'] ?? null, 'distributorName' => $dist['name'] ?? null, 'status' => 'active',
                'createdAt' => FV::now(), 'updatedAt' => FV::now(),
            ]);
            $tx->create(COL_WALLETS . "/$affId", [
                'affiliateId' => $affId, 'affiliateUid' => $uid, 'balance' => 0, 'reserved' => 0, 'totalEarned' => 0,
                'totalRedeemed' => 0, 'totalAdjusted' => 0, 'lastPurchase' => null, 'updatedAt' => FV::now(),
            ]);
            $tx->set(COL_USERS . "/$uid", [
                'role' => 'affiliate', 'affiliateId' => $affId, 'displayName' => $fullName, 'loginId' => $idNumber,
                'email' => $email ?: null, 'status' => 'active', 'createdAt' => FV::now(),
            ]);
            $tx->create(registry_path($idKey), ['type' => 'affiliate', 'affiliateId' => $affId]);
            $tx->create(registry_path("code:$code"), ['type' => 'affiliate', 'affiliateId' => $affId]);
            if ($dist) $tx->update(COL_DIST . "/{$dist['id']}", ['affiliateCount' => FV::inc(1)]);
            bump_stats($tx, ['affiliates' => 1], ['newAffiliates' => 1], $dist['id'] ?? null, ['newAffiliates' => 1]);
            audit($tx, ['uid' => $uid, 'role' => 'affiliate'], 'affiliate.register', 'affiliate', $affId, ['distributorId' => $dist['id'] ?? null, 'idType' => $idType]);
            return ['affiliateId' => $affId, 'code' => $code];
        });
        AuthAdmin::setClaims($uid, ['role' => 'affiliate', 'affiliateId' => $affId]);
        return $res + ['loginEmail' => $loginEmail];
    } catch (Throwable $e) {
        AuthAdmin::delete($uid); // deshace la cuenta de acceso
        throw $e;
    }
}

/** Público: nombre del distribuidor al abrir su QR de registro. */
function fn_resolveRegistrationCode(array $d): array
{
    rate_limit('resolve', 60, 600);
    $code = strtoupper(str_arg($d, 'code', 'Código', 1, 20));
    $q = Ctx::db()->query(['from' => COL_DIST, 'where' => [['registrationCode', '==', $code]], 'limit' => 1]);
    if (!$q || $q[0]->get('status') !== 'active') return ['valid' => false];
    return ['valid' => true, 'name' => $q[0]->get('name'), 'city' => $q[0]->get('city')];
}

function find_affiliate_by_content(string $content): ?Doc
{
    $db = Ctx::db();
    $p = Domain::decodeAffiliateQr($content);
    if (!$p) fail('invalid-argument', 'El QR o código no corresponde a un afiliado de la red.');
    if (isset($p['qrToken'])) {
        $q = $db->query(['from' => COL_AFF, 'where' => [['qrToken', '==', $p['qrToken']]], 'limit' => 1]);
        return $q[0] ?? null;
    }
    $reg = $db->get(registry_path("code:{$p['code']}"));
    if ($reg->exists() && $reg->get('type') === 'affiliate') { $a = $db->get(COL_AFF . '/' . $reg->get('affiliateId')); return $a->exists() ? $a : null; }
    return null;
}

/** Identifica al socio por su QR o código. Solo distribuidores y admin; datos mínimos. */
function fn_lookupAffiliate(array $d): array
{
    $actor = requireRole('distributor', 'admin');
    $a = find_affiliate_by_content(str_arg($d, 'content', 'QR o código', 1, 100));
    if (!$a) fail('not-found', 'Afiliado no encontrado.');
    return [
        'id' => $a->id(), 'fullName' => $a->get('fullName'), 'code' => $a->get('code'), 'status' => $a->get('status'),
        'idMasked' => mask_id((string) $a->get('idNumber')), 'linkedDistributorName' => $a->get('distributorName'),
        'linkedToYou' => $actor['distributorId'] ? $a->get('distributorId') === $actor['distributorId'] : false,
    ];
}

/** Búsqueda por código, identificación, teléfono o nombre (prefijo). */
function fn_searchAffiliates(array $d): array
{
    $actor = requireRole('distributor', 'admin');
    $db = Ctx::db();
    $q = str_arg($d, 'q', 'Búsqueda', 2, 80);
    $asCode = Domain::decodeAffiliateQr($q);
    $phone = Domain::normalizeEcPhone($q);
    if (isset($asCode['code'])) {
        $docs = $db->query(['from' => COL_AFF, 'where' => [['code', '==', $asCode['code']]], 'limit' => 5]);
    } elseif ($phone || (preg_match('/^[0-9A-Z]{5,20}$/i', $q) && preg_match('/\d/', $q))) {
        // Una cédula de Guayas (09…) también parece un celular: se consultan ambos campos.
        $docs = $db->query(['from' => COL_AFF, 'where' => [['idNumber', '==', strtoupper(preg_replace('/\s/', '', $q))]], 'limit' => 5]);
        if ($phone) $docs = array_merge($docs, $db->query(['from' => COL_AFF, 'where' => [['phone', '==', $phone]], 'limit' => 20]));
        $seen = []; $docs = array_values(array_filter($docs, function (Doc $x) use (&$seen) { if (isset($seen[$x->id()])) return false; return $seen[$x->id()] = true; }));
    } else {
        $key = Domain::searchKey($q);
        $docs = $db->query(['from' => COL_AFF, 'where' => [['searchName', '>=', $key], ['searchName', '<=', $key . "\u{f8ff}"]], 'orderBy' => [['searchName', 'asc']], 'limit' => 20]);
    }
    $isAdmin = $actor['role'] === 'admin';
    $balances = [];
    if ($isAdmin && $docs) foreach ($db->getAll(array_map(fn(Doc $x) => COL_WALLETS . '/' . $x->id(), $docs)) as $w) $balances[$w->id()] = (int) $w->get('balance', 0);
    return ['results' => array_map(function (Doc $a) use ($actor, $isAdmin, $balances) {
        $base = [
            'id' => $a->id(), 'fullName' => $a->get('fullName'), 'code' => $a->get('code'), 'status' => $a->get('status'),
            'idMasked' => mask_id((string) $a->get('idNumber')), 'linkedToYou' => $actor['distributorId'] ? $a->get('distributorId') === $actor['distributorId'] : false,
        ];
        return $isAdmin ? $base + ['idNumber' => $a->get('idNumber'), 'phone' => $a->get('phone'), 'email' => $a->get('email'), 'distributorName' => $a->get('distributorName'), 'balance' => $balances[$a->id()] ?? 0] : $base;
    }, $docs)];
}

/** El socio edita teléfono y correo de contacto. Queda historial en auditoría. */
function fn_updateMyProfile(array $d): array
{
    $actor = requireRole('affiliate');
    $phone = Domain::normalizeEcPhone(str_arg($d, 'phone', 'Teléfono', 7, 20));
    if (!$phone) fail('invalid-argument', 'Teléfono inválido.');
    $email = strtolower(str_arg($d, 'email', 'Correo', 1, 120, true));
    if ($email && !valid_email($email)) fail('invalid-argument', 'Correo inválido.');
    $path = COL_AFF . '/' . $actor['affiliateId'];
    Ctx::db()->runTransaction(function (Tx $tx) use ($path, $phone, $email, $actor) {
        $a = $tx->get($path);
        if (!$a->exists()) fail('not-found', 'Perfil no encontrado.');
        $before = ['phone' => $a->get('phone'), 'email' => $a->get('email')];
        $after = ['phone' => $phone, 'email' => $email ?: null];
        $tx->update($path, $after + ['updatedAt' => FV::now()]);
        $tx->update(COL_USERS . '/' . $actor['uid'], ['email' => $email ?: null]);
        audit($tx, $actor, 'affiliate.updateProfile', 'affiliate', $a->id(), ['before' => $before, 'after' => $after]);
    });
    return ['ok' => true];
}
