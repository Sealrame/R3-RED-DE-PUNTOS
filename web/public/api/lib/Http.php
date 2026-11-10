<?php
declare(strict_types=1);

final class Http
{
    /** @return array{status:int, json:mixed, body:string, headers:array<string,string>} */
    public static function request(string $method, string $url, mixed $body = null, array $headers = [], bool $form = false): array
    {
        $ch = curl_init($url);
        $h = ['Accept: application/json'];
        foreach ($headers as $k => $v) $h[] = "$k: $v";
        $opts = [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_HEADER => true, CURLOPT_NOPROXY => 'localhost,127.0.0.1,::1'];
        if ($body !== null) {
            if ($form) { $opts[CURLOPT_POSTFIELDS] = http_build_query($body); $h[] = 'Content-Type: application/x-www-form-urlencoded'; }
            else { $opts[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION); $h[] = 'Content-Type: application/json'; }
        }
        $opts[CURLOPT_HTTPHEADER] = $h;
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        if ($raw === false) { $e = curl_error($ch); curl_close($ch); fail('unavailable', 'Sin conexión con los servicios de Google: ' . $e); }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $hsize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);
        $rawHeaders = substr($raw, 0, $hsize);
        $bodyStr = substr($raw, $hsize);
        $hdrs = [];
        foreach (explode("\r\n", $rawHeaders) as $line) if (str_contains($line, ':')) { [$k, $v] = explode(':', $line, 2); $hdrs[strtolower(trim($k))] = trim($v); }
        return ['status' => $status, 'json' => json_decode($bodyStr, true), 'body' => $bodyStr, 'headers' => $hdrs];
    }
}
