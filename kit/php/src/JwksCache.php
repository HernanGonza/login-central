<?php
declare(strict_types=1);

namespace Ministerio\Sso;

/**
 * JWKS con cache en archivo (1 h). Ante un kid desconocido se refresca UNA vez
 * (con un minimo de $minForzado s entre refrescos forzados, para que un atacante
 * no use kids al azar para saturar al portal).
 */
final class JwksCache
{
    private $fetcher;
    private $reloj;

    /**
     * @param callable():string $fetcher devuelve el JSON del JWKS
     * @param callable():int|null $reloj
     */
    public function __construct(
        callable $fetcher,
        private string $archivo,
        private int $ttl = 3600,
        private int $minForzado = 10,
        ?callable $reloj = null,
    ) {
        $this->fetcher = $fetcher;
        $this->reloj = $reloj;
    }

    /**
     * Fetcher HTTP para el JWKS. Exige https:// (http solo para localhost/127.0.0.1/::1,
     * o con $permitirHttp = true, unicamente en desarrollo). Lanza InvalidArgumentException.
     *
     * @return callable():string
     */
    public static function fetcherHttp(string $url, bool $permitirHttp = false, int $timeout = 3): callable
    {
        $p = parse_url($url);
        $esquema = strtolower((string) ($p['scheme'] ?? ''));
        $host = strtolower(trim((string) ($p['host'] ?? ''), '[]'));
        $local = in_array($host, ['localhost', '127.0.0.1', '::1'], true);
        if ($host === '' || !($esquema === 'https' || ($esquema === 'http' && ($local || $permitirHttp)))) {
            throw new \InvalidArgumentException('SSO_JWKS_URL debe ser https:// (http solo en localhost o con permitirHttp)');
        }
        return static function () use ($url, $timeout): string {
            $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'follow_location' => 0]]);
            $r = @file_get_contents($url, false, $ctx);
            if ($r === false) {
                throw new \RuntimeException('JWKS no disponible');
            }
            return $r;
        };
    }

    private function ahora(): int
    {
        return $this->reloj ? (int) ($this->reloj)() : time();
    }

    /** @return array<string,mixed>|null JWK con ese kid */
    public function clave(string $kid): ?array
    {
        $c = $this->leer();
        if ($c === null || $this->ahora() - $c['t'] > $this->ttl) {
            $c = $this->refrescar($c) ?? $c;
        }
        if ($c !== null && isset($c['keys'][$kid])) {
            return $c['keys'][$kid];
        }
        // kid desconocido: refrescar una vez (con freno)
        if ($c === null || time() - (int) $c['forzado'] >= $this->minForzado) {
            $n = $this->refrescar($c, true);
            if ($n !== null && isset($n['keys'][$kid])) {
                return $n['keys'][$kid];
            }
        }
        return null;
    }

    /** @return array{t:int,forzado:int,keys:array<string,array>}|null */
    private function leer(): ?array
    {
        $raw = @file_get_contents($this->archivo);
        $d = $raw === false ? null : json_decode($raw, true);
        return is_array($d) && isset($d['t'], $d['keys']) ? $d + ['forzado' => 0] : null;
    }

    private function refrescar(?array $previo, bool $forzado = false): ?array
    {
        try {
            $d = json_decode(($this->fetcher)(), true);
            if (!is_array($d) || !isset($d['keys']) || !is_array($d['keys'])) {
                return null;
            }
            $keys = [];
            foreach ($d['keys'] as $k) {
                if (is_array($k) && isset($k['kid'], $k['n'], $k['e']) && ($k['kty'] ?? '') === 'RSA') {
                    $keys[(string) $k['kid']] = $k;
                }
            }
            if ($keys === []) {
                return null; // JWKS vacio o sin claves RSA validas: no pisar el cache anterior
            }
            $c = [
                't' => $this->ahora(),
                'forzado' => $forzado ? time() : (int) ($previo['forzado'] ?? 0),
                'keys' => $keys,
            ];
            $tmp = $this->archivo . '.' . bin2hex(random_bytes(4));
            if (@file_put_contents($tmp, json_encode($c), LOCK_EX) !== false) {
                @chmod($tmp, 0600);
                @rename($tmp, $this->archivo);
            }
            return $c;
        } catch (\Throwable) {
            return null; // portal caido: se sigue con lo que haya en cache
        }
    }
}
