<?php
declare(strict_types=1);

namespace Ministerio\Sso;

/**
 * Rutas /sso/acceso y /sso/login sin framework.
 *
 * acceso()/login() son puros (reciben datos, devuelven
 * ['status'=>int,'headers'=>[],'body'=>string]) para poder probarlos.
 * atender() los conecta con $_SERVER/$_POST y emite la respuesta.
 *
 * Opciones:
 *  verificador   Verificador (obligatorio)
 *  buscarUsuario callable(string $email): ?array{id,rol?,activo}
 *                (def.: funcion global buscarUsuarioPorCorreo)
 *  abrirSesion   callable(array $usuario, array $claims): void (obligatorio para login)
 *  urlInicio     destino del 302 tras abrir sesion (def. '/')
 *  urlPortal     enlace de la pagina "sin acceso"
 *  origenPortal  origen del portal (def.: el de urlPortal). Defensa CSRF de login(): con Origin debe ser
 *                igual (el literal "null" se rechaza); sin Origin se rechaza Sec-Fetch-Site: cross-site;
 *                sin ninguno de los dos se acepta (clientes sin cabeceras).
 *  log           callable(string $evento, string $motivo): void (nunca recibe el pase)
 */
final class Rutas
{
    private $buscar;
    private $abrir;
    private $log;

    /** @param array<string,mixed> $o */
    public function __construct(private array $o)
    {
        $this->buscar = $o['buscarUsuario'] ?? (function_exists('buscarUsuarioPorCorreo') ? 'buscarUsuarioPorCorreo' : null);
        $this->abrir = $o['abrirSesion'] ?? null;
        $this->log = $o['log'] ?? null;
        if (!$this->buscar) {
            throw new \InvalidArgumentException('Falta buscarUsuarioPorCorreo');
        }
    }

    /** GET /sso/acceso: $authorization = valor del header Authorization. */
    public function acceso(?string $authorization): array
    {
        try {
            return $this->accesoInterno($authorization);
        } catch (\Throwable $e) {
            // Sin stack ni rutas: solo la clase de la excepcion.
            $this->registrar('acceso', 'error:' . $e::class);
            return $this->resp(401, '{"error":"no autorizado"}', 'application/json');
        }
    }

    private function accesoInterno(?string $authorization): array
    {
        $token = null;
        if ($authorization !== null && preg_match('/^Bearer\s+(\S+)$/i', trim($authorization), $m)) {
            $token = $m[1];
        }
        if ($token === null) {
            $this->registrar('acceso', 'ausente');
            return $this->resp(401, '{"error":"no autorizado"}', 'application/json');
        }
        $r = $this->o['verificador']->verificar($token, 'acceso');
        if (!$r['ok']) {
            $this->registrar('acceso', $r['motivo']);
            return $this->resp(401, '{"error":"no autorizado"}', 'application/json');
        }
        $u = ($this->buscar)($r['claims']['email']);
        if (!is_array($u) || empty($u['activo'])) {
            return $this->resp(200, '{"acceso":false}', 'application/json');
        }
        $out = ['acceso' => true];
        if (isset($u['rol']) && is_string($u['rol']) && $u['rol'] !== '') {
            $out['rol'] = $u['rol'];
        }
        return $this->resp(200, json_encode($out, JSON_UNESCAPED_UNICODE), 'application/json');
    }

    /** POST /sso/login: $token = campo "token" del formulario. */
    public function login(?string $token, ?string $origin = null, ?string $secFetchSite = null): array
    {
        try {
            return $this->loginInterno($token, $origin, $secFetchSite);
        } catch (\Throwable $e) {
            $this->registrar('login', 'error:' . $e::class);
            return $this->sinAcceso();
        }
    }

    private function loginInterno(?string $token, ?string $origin, ?string $secFetchSite): array
    {
        if (!$this->origenPermitido($origin, $secFetchSite)) {
            $this->registrar('login', 'origen');
            return $this->sinAcceso();
        }
        if (!is_string($token) || $token === '') {
            $this->registrar('login', 'ausente');
            return $this->sinAcceso();
        }
        $r = $this->o['verificador']->verificar($token, 'login');
        if (!$r['ok']) {
            $this->registrar('login', $r['motivo']);
            return $this->sinAcceso();
        }
        $u = ($this->buscar)($r['claims']['email']);
        if (!is_array($u) || empty($u['activo'])) {
            $this->registrar('login', 'usuario');
            return $this->sinAcceso();
        }
        if (!$this->abrir) {
            throw new \LogicException('Falta abrirSesion');
        }
        ($this->abrir)($u, $r['claims']);
        $resp = $this->resp(302, '', 'text/plain');
        $resp['headers']['Location'] = (string) ($this->o['urlInicio'] ?? '/');
        return $resp;
    }

    /** Origen "esquema://host[:puerto]" de una URL, o null si no se puede determinar. */
    private static function origenDe(string $url): ?string
    {
        $p = parse_url($url);
        if (!is_array($p) || empty($p['scheme']) || empty($p['host'])) {
            return null;
        }
        $o = strtolower($p['scheme']) . '://' . strtolower($p['host']);
        $esquema = strtolower($p['scheme']);
        $defecto = ['http' => 80, 'https' => 443][$esquema] ?? null;
        if (isset($p['port']) && $p['port'] !== $defecto) { // https://portal:443 == https://portal
            $o .= ':' . $p['port'];
        }
        return $o;
    }

    private function origenPermitido(?string $origin, ?string $secFetchSite): bool
    {
        if ($origin !== null) {
            $esperado = self::origenDe((string) ($this->o['origenPortal'] ?? $this->o['urlPortal'] ?? ''));
            // El header Origin es solo esquema://host[:puerto]; cualquier otra cosa (ruta, usuario, "null") se rechaza.
            $p = parse_url($origin);
            if (!is_array($p) || isset($p['user']) || isset($p['pass']) || isset($p['query']) || isset($p['fragment'])
                || (isset($p['path']) && $p['path'] !== '')) {
                return false;
            }
            $recibido = self::origenDe($origin);
            return $esperado !== null && $recibido !== null && $recibido === $esperado;
        }
        if ($secFetchSite !== null) {
            return strtolower(trim($secFetchSite)) !== 'cross-site';
        }
        return true;
    }

    /** Conecta con las superglobales de PHP y emite la respuesta. */
    public function atender(?string $ruta = null): void
    {
        try {
            $r = $this->despachar($ruta);
        } catch (\Throwable $e) {
            $this->registrar('atender', 'error:' . $e::class);
            $r = $this->resp(500, '', 'text/plain');
        }
        http_response_code($r['status']);
        foreach ($r['headers'] as $k => $v) {
            header("$k: $v");
        }
        echo $r['body'];
    }

    private function despachar(?string $ruta): array
    {
        $ruta ??= (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        $metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $ruta = rtrim($ruta, '/');
        if ($ruta === '/sso/acceso' && $metodo === 'GET') {
            $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null;
            return $this->acceso($auth);
        }
        if ($ruta === '/sso/login' && $metodo === 'POST') {
            $t = $_POST['token'] ?? null;
            return $this->login(
                is_string($t) ? $t : null,
                isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : null,
                isset($_SERVER['HTTP_SEC_FETCH_SITE']) ? (string) $_SERVER['HTTP_SEC_FETCH_SITE'] : null,
            );
        }
        if ($ruta === '/sso/acceso' || $ruta === '/sso/login') {
            return $this->resp(405, '', 'text/plain');
        }
        return $this->resp(404, '', 'text/plain');
    }

    private function sinAcceso(): array
    {
        $portal = htmlspecialchars((string) ($this->o['urlPortal'] ?? '/'), ENT_QUOTES, 'UTF-8');
        $html = '<!doctype html><html lang="es"><meta charset="utf-8"><title>Sin acceso</title>'
            . '<body style="font-family:sans-serif;background:#f4f7f4;color:#222;padding:3rem">'
            . '<h1 style="color:#2f6b4a">Sin acceso</h1><p>No pudimos darte acceso a este sistema.</p>'
            . '<p><a href="' . $portal . '">Volver al portal</a></p></body></html>';
        return $this->resp(403, $html, 'text/html; charset=utf-8');
    }

    private function resp(int $status, string $body, string $tipo): array
    {
        return ['status' => $status, 'body' => $body, 'headers' => [
            'Content-Type' => $tipo,
            'Cache-Control' => 'no-store, no-cache, must-revalidate',
            'Pragma' => 'no-cache',
            'Referrer-Policy' => 'no-referrer',
        ]];
    }

    private function registrar(string $ev, string $motivo): void
    {
        if ($this->log) {
            try {
                ($this->log)($ev, $motivo);
            } catch (\Throwable) {
                // un log que falla no debe cambiar la respuesta
            }
        }
    }
}
