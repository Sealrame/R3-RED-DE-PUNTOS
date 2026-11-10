<?php
/**
 * Cliente mínimo de Cloud Firestore por REST (v1), con transacciones atómicas.
 * Usa la cuenta de servicio (omite las Security Rules, igual que el Admin SDK).
 */
declare(strict_types=1);

/** Marca de tiempo Firestore. */
final class Ts
{
    public function __construct(public readonly string $iso) {}
    public static function now(): self { return new self(gmdate('Y-m-d\TH:i:s') . sprintf('.%06dZ', (int) ((microtime(true) * 1e6) % 1e6))); }
    public static function fromUnix(float $t): self { return new self(gmdate('Y-m-d\TH:i:s', (int) $t) . sprintf('.%06dZ', (int) (fmod($t, 1) * 1e6))); }
    public function unixMs(): int { return (int) round((new DateTimeImmutable($this->iso))->format('U.u') * 1000); }
}

/** Transformaciones de servidor (increment, serverTimestamp, arrayUnion). */
final class FV
{
    private function __construct(public readonly string $kind, public readonly mixed $value = null) {}
    public static function inc(int|float $n): self { return new self('inc', $n); }
    public static function now(): self { return new self('now'); }
    public static function union(array $values): self { return new self('union', $values); }
}

final class Doc
{
    public function __construct(public readonly string $path, public readonly ?array $data) {}
    public function exists(): bool { return $this->data !== null; }
    public function id(): string { $p = explode('/', $this->path); return end($p); }
    public function get(string $field, mixed $default = null): mixed { return $this->data[$field] ?? $default; }
}

final class Firestore
{
    private string $root;   // https://…/v1/projects/p/databases/(default)/documents
    private string $prefix; // projects/p/databases/(default)/documents

    public function __construct()
    {
        $cfg = Config::get();
        $this->prefix = "projects/{$cfg['projectId']}/databases/(default)/documents";
        $host = $cfg['firestoreEmulator'] ? 'http://' . $cfg['firestoreEmulator'] : 'https://firestore.googleapis.com';
        $this->root = "$host/v1/{$this->prefix}";
    }

    public function name(string $path): string { return "{$this->prefix}/$path"; }
    public function pathOf(string $name): string { return substr($name, strlen($this->prefix) + 1); }

    public function call(string $method, string $suffix, ?array $body = null): array
    {
        $r = Http::request($method, $this->root . $suffix, $body, ['Authorization' => 'Bearer ' . GoogleAuth::accessToken()]);
        if ($r['status'] >= 200 && $r['status'] < 300) return is_array($r['json']) ? $r['json'] : [];
        $st = $r['json']['error']['status'] ?? (is_array($r['json']) && isset($r['json'][0]['error']) ? $r['json'][0]['error']['status'] : '');
        if ($r['status'] === 404 || $st === 'NOT_FOUND') return ['__notFound' => true];
        if ($st === 'ABORTED' || $r['status'] === 409) throw new ApiError('aborted', 'Conflicto de concurrencia, reintentando.');
        if ($st === 'FAILED_PRECONDITION' && str_contains($r['body'], 'index')) fail('failed-precondition', 'Falta un índice en Firestore. Publica firestore.indexes.json.');
        error_log('[firestore] ' . $r['status'] . ' ' . substr($r['body'], 0, 500));
        fail('internal', 'Error de base de datos.');
    }

    /* ---------- Lecturas ---------- */
    public function get(string $path, ?string $tx = null): Doc
    {
        // Dentro de transacciones se usa batchGet (más robusto, incluido el emulador).
        if ($tx) return $this->getAll([$path], $tx)[0];
        $q = '';
        $r = $this->call('GET', '/' . self::encPath($path) . $q);
        return new Doc($path, isset($r['__notFound']) ? null : self::decodeFields($r['fields'] ?? []));
    }

    /** @return Doc[] en el mismo orden */
    public function getAll(array $paths, ?string $tx = null): array
    {
        if (!$paths) return [];
        $body = ['documents' => array_map(fn($p) => $this->name($p), $paths)];
        if ($tx) $body['transaction'] = $tx;
        $r = $this->call('POST', ':batchGet', $body);
        $by = [];
        foreach ($r as $item) {
            if (isset($item['found'])) $by[$this->pathOf($item['found']['name'])] = self::decodeFields($item['found']['fields'] ?? []);
        }
        return array_map(fn($p) => new Doc($p, $by[$p] ?? null), $paths);
    }

    /**
     * @param array $q ['from'=>col, 'where'=>[[field, op, value]...], 'orderBy'=>[[field,'asc'|'desc']], 'limit'=>n, 'select'=>[fields], 'startAfter'=>docPath]
     * @return Doc[]
     */
    public function query(array $q, ?string $tx = null): array
    {
        $sq = ['from' => [['collectionId' => $q['from']]]];
        $ops = ['==' => 'EQUAL', '>=' => 'GREATER_THAN_OR_EQUAL', '<=' => 'LESS_THAN_OR_EQUAL', '>' => 'GREATER_THAN', '<' => 'LESS_THAN', 'array-contains' => 'ARRAY_CONTAINS'];
        $filters = [];
        foreach ($q['where'] ?? [] as [$f, $op, $v]) $filters[] = ['fieldFilter' => ['field' => ['fieldPath' => $f], 'op' => $ops[$op], 'value' => self::encodeValue($v)]];
        if (count($filters) === 1) $sq['where'] = $filters[0];
        elseif ($filters) $sq['where'] = ['compositeFilter' => ['op' => 'AND', 'filters' => $filters]];
        foreach ($q['orderBy'] ?? [] as [$f, $dir]) $sq['orderBy'][] = ['field' => ['fieldPath' => $f], 'direction' => $dir === 'desc' ? 'DESCENDING' : 'ASCENDING'];
        if (isset($q['limit'])) $sq['limit'] = $q['limit'];
        if (isset($q['select'])) $sq['select'] = ['fields' => array_map(fn($f) => ['fieldPath' => $f], $q['select'])];
        if (isset($q['startAfter'])) $sq['startAt'] = ['values' => [['referenceValue' => $this->name($q['startAfter'])]], 'before' => false];
        $body = ['structuredQuery' => $sq];
        if ($tx) $body['transaction'] = $tx;
        $r = $this->call('POST', ':runQuery', $body);
        $out = [];
        foreach ($r as $row) if (isset($row['document'])) $out[] = new Doc($this->pathOf($row['document']['name']), self::decodeFields($row['document']['fields'] ?? []));
        return $out;
    }

    /* ---------- Transacciones ---------- */
    /** Ejecuta $fn(Tx) de forma atómica, con reintentos ante conflictos. */
    public function runTransaction(callable $fn): mixed
    {
        for ($attempt = 1; ; $attempt++) {
            $id = $this->call('POST', ':beginTransaction', ['options' => ['readWrite' => (object) []]])['transaction'];
            $tx = new Tx($this, $id);
            try {
                $result = $fn($tx);
                $this->call('POST', ':commit', ['writes' => $tx->writes(), 'transaction' => $id]);
                return $result;
            } catch (ApiError $e) {
                if ($e->codeName !== 'aborted') { try { $this->call('POST', ':rollback', ['transaction' => $id]); } catch (Throwable) {} throw $e; }
                if ($attempt >= 6) fail('aborted', 'Demasiada concurrencia. Intenta de nuevo.');
                usleep(random_int(50, 250) * 1000 * $attempt);
            }
        }
    }

    /** Escrituras sin lecturas previas (lote atómico). */
    public function commitWrites(array $writes): void
    {
        if ($writes) $this->call('POST', ':commit', ['writes' => $writes]);
    }

    /**
     * Construye una escritura. $mode: 'set' (reemplaza), 'merge' (solo campos dados), 'update' (debe existir), 'create' (no debe existir).
     */
    public function buildWrite(string $path, array $data, string $mode): array
    {
        $fields = []; $transforms = [];
        foreach ($data as $k => $v) {
            if ($v instanceof FV) {
                $t = ['fieldPath' => $k];
                if ($v->kind === 'inc') $t['increment'] = self::encodeValue($v->value);
                elseif ($v->kind === 'now') $t['setToServerValue'] = 'REQUEST_TIME';
                else $t['appendMissingElements'] = ['values' => array_map([self::class, 'encodeValue'], $v->value)];
                $transforms[] = $t;
            } else $fields[$k] = self::encodeValue($v);
        }
        $w = ['update' => ['name' => $this->name($path), 'fields' => (object) $fields]];
        if ($mode !== 'set' && $mode !== 'create') $w['updateMask'] = ['fieldPaths' => array_map([self::class, 'fieldPath'], array_keys($fields))];
        if ($transforms) $w['updateTransforms'] = $transforms;
        if ($mode === 'update') $w['currentDocument'] = ['exists' => true];
        if ($mode === 'create') $w['currentDocument'] = ['exists' => false];
        return $w;
    }

    /* ---------- Codificación de valores ---------- */
    public static function encodeValue(mixed $v): array
    {
        return match (true) {
            $v === null => ['nullValue' => null],
            is_bool($v) => ['booleanValue' => $v],
            is_int($v) => ['integerValue' => (string) $v],
            is_float($v) => ['doubleValue' => $v],
            is_string($v) => ['stringValue' => $v],
            $v instanceof Ts => ['timestampValue' => $v->iso],
            is_array($v) && array_is_list($v) => ['arrayValue' => $v ? ['values' => array_map([self::class, 'encodeValue'], $v)] : (object) []],
            is_array($v) => ['mapValue' => ['fields' => (object) array_map([self::class, 'encodeValue'], $v)]],
            default => throw new ApiError('internal', 'Tipo de dato no soportado.'),
        };
    }

    public static function decodeValue(array $v): mixed
    {
        if (array_key_exists('nullValue', $v)) return null;
        if (isset($v['booleanValue'])) return (bool) $v['booleanValue'];
        if (isset($v['integerValue'])) return (int) $v['integerValue'];
        if (isset($v['doubleValue'])) return (float) $v['doubleValue'];
        if (isset($v['stringValue'])) return $v['stringValue'];
        if (isset($v['timestampValue'])) return new Ts($v['timestampValue']);
        if (isset($v['arrayValue'])) return array_map([self::class, 'decodeValue'], $v['arrayValue']['values'] ?? []);
        if (isset($v['mapValue'])) return self::decodeFields($v['mapValue']['fields'] ?? []);
        if (isset($v['referenceValue'])) return $v['referenceValue'];
        return null;
    }

    public static function decodeFields(array $fields): array
    {
        $o = [];
        foreach ($fields as $k => $v) $o[$k] = self::decodeValue($v);
        return $o;
    }

    private static function fieldPath(string $f): string { return preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $f) ? $f : '`' . str_replace('`', '\\`', $f) . '`'; }
    private static function encPath(string $p): string { return implode('/', array_map('rawurlencode', explode('/', $p))); }
}

/** Transacción: las lecturas van primero; las escrituras se envían juntas en commit. */
final class Tx
{
    private array $writes = [];
    public function __construct(private Firestore $db, public readonly string $id) {}
    public function get(string $path): Doc { return $this->db->get($path, $this->id); }
    /** @return Doc[] */
    public function getAll(array $paths): array { return $this->db->getAll($paths, $this->id); }
    /** @return Doc[] */
    public function query(array $q): array { return $this->db->query($q, $this->id); }
    public function set(string $path, array $data): void { $this->writes[] = $this->db->buildWrite($path, $data, 'set'); }
    public function merge(string $path, array $data): void { $this->writes[] = $this->db->buildWrite($path, $data, 'merge'); }
    public function update(string $path, array $data): void { $this->writes[] = $this->db->buildWrite($path, $data, 'update'); }
    public function create(string $path, array $data): void { $this->writes[] = $this->db->buildWrite($path, $data, 'create'); }
    public function writes(): array { return $this->writes; }
}
