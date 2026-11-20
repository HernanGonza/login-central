<?php
declare(strict_types=1);

namespace Ministerio\Sso;

/**
 * Verificacion del pase segun CONTRATO.md seccion 2 (el primer fallo corta).
 * Los motivos (formato|alg|firma|iss|aud|exp|use|jti) son para el codigo
 * llamador y los logs; NUNCA se envian al cliente HTTP.
 */
final class Verificador
{
    public const TOLERANCIA = 60;
    /** Vida maxima del pase: 60 s (contrato) mas la tolerancia de reloj. */
    public const VIDA_MAX = 60 + self::TOLERANCIA;

    private $reloj;

    /** @param callable():int|null $reloj */
    public function __construct(
        private JwksCache $jwks,
        private string $iss,
        private string $aud,
        private ?JtiStore $jti = null,
        ?callable $reloj = null,
    ) {
        $this->reloj = $reloj;
    }

    /** @return array{ok:true,claims:array<string,mixed>}|array{ok:false,motivo:string} */
    public function verificar(string $token, string $useEsperado): array
    {
        $fallo = static fn (string $m): array => ['ok' => false, 'motivo' => $m];

        // 1. formato y alg
        if (strlen($token) > 8192) {
            return $fallo('formato');
        }
        $p = explode('.', $token);
        if (count($p) !== 3) {
            return $fallo('formato');
        }
        $h = self::json($p[0]);
        if ($h === null) {
            return $fallo('formato');
        }
        if (($h['alg'] ?? null) !== 'RS256') {
            return $fallo('alg');
        }
        $kid = $h['kid'] ?? null;
        $sig = self::b64($p[2]);
        if (!is_string($kid) || $kid === '' || $sig === null || $sig === '') {
            return $fallo('formato');
        }

        // 2. firma
        $jwk = $this->jwks->clave($kid);
        if ($jwk === null) {
            return $fallo('firma');
        }
        $pem = self::jwkAPem($jwk);
        if ($pem === null || openssl_verify($p[0] . '.' . $p[1], $sig, $pem, OPENSSL_ALGO_SHA256) !== 1) {
            return $fallo('firma');
        }
        $c = self::json($p[1]);
        if ($c === null) {
            return $fallo('formato');
        }

        // 3-6
        if (($c['iss'] ?? null) !== $this->iss) {
            return $fallo('iss');
        }
        if (!isset($c['aud']) || !is_string($c['aud']) || $c['aud'] !== $this->aud) {
            return $fallo('aud');
        }
        $ahora = $this->reloj ? (int) ($this->reloj)() : time();
        if (!isset($c['exp']) || !is_int($c['exp']) || $c['exp'] + self::TOLERANCIA < $ahora) {
            return $fallo('exp');
        }
        if (!isset($c['iat']) || !(is_int($c['iat']) || is_float($c['iat']))
            || $c['iat'] > $ahora + self::TOLERANCIA || $c['exp'] - $c['iat'] > self::VIDA_MAX) {
            return $fallo('exp');
        }
        if (($c['use'] ?? null) !== $useEsperado) {
            return $fallo('use');
        }

        // 7. jti de un solo uso (solo login)
        if ($useEsperado === 'login') {
            $jti = $c['jti'] ?? null;
            if (!is_string($jti) || $jti === '' || $this->jti === null) {
                return $fallo('jti');
            }
            if (!$this->jti->usar($jti, $c['exp'])) {
                return $fallo('jti');
            }
        }

        if (!isset($c['email']) || !is_string($c['email'])) {
            return $fallo('formato');
        }
        $c['email'] = strtolower(trim($c['email']));
        return ['ok' => true, 'claims' => $c];
    }

    /** @return array<string,mixed>|null */
    private static function json(string $b64): ?array
    {
        $raw = self::b64($b64);
        $d = $raw === null ? null : json_decode($raw, true);
        return is_array($d) ? $d : null;
    }

    private static function b64(string $s): ?string
    {
        if ($s !== '' && !preg_match('/^[A-Za-z0-9_-]+$/', $s)) {
            return null;
        }
        $r = base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
        return $r === false ? null : $r;
    }

    private static function jwkAPem(array $jwk): ?string
    {
        $n = self::b64((string) ($jwk['n'] ?? ''));
        $e = self::b64((string) ($jwk['e'] ?? ''));
        if ($n === null || $e === null || $n === '' || $e === '') {
            return null;
        }
        $len = static function (int $l): string {
            if ($l < 128) {
                return chr($l);
            }
            $b = ltrim(pack('N', $l), "\0");
            return chr(0x80 | strlen($b)) . $b;
        };
        $int = static function (string $v) use ($len): string {
            $v = ltrim($v, "\0");
            if ($v === '' || ord($v[0]) > 0x7f) {
                $v = "\0" . $v;
            }
            return "\x02" . $len(strlen($v)) . $v;
        };
        $seq = static fn (string $v): string => "\x30" . $len(strlen($v)) . $v;
        $rsa = $seq($int($n) . $int($e));
        $algo = hex2bin('300d06092a864886f70d0101010500');
        $bits = "\0" . $rsa;
        $spki = $seq($algo . "\x03" . $len(strlen($bits)) . $bits);
        return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
    }
}
