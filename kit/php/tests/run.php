<?php
declare(strict_types=1);

// Pruebas sin framework. Uso: php tests/run.php  (sale con codigo 1 si algo falla)
require __DIR__ . '/../src/autoload.php';

use Ministerio\Sso\ArchivoJtiStore;
use Ministerio\Sso\JwksCache;
use Ministerio\Sso\MemoriaJtiStore;
use Ministerio\Sso\PdoJtiStore;
use Ministerio\Sso\Rutas;
use Ministerio\Sso\Verificador;

$dirV = getenv('SSO_VECTORES') ?: __DIR__ . '/../../../docs/sso/vectores';
$V = json_decode(file_get_contents("$dirV/vectores.PRUEBA.json"), true);
$jwksJson = file_get_contents("$dirV/" . $V['jwks']);
$AHORA = $V['ahora'];
$tmp = sys_get_temp_dir() . '/sso-kit-test-' . bin2hex(random_bytes(4));
mkdir($tmp, 0700, true);

$total = 0;
$fallos = 0;
function t(string $nombre, bool $ok, string $detalle = ''): void
{
    global $total, $fallos;
    $total++;
    if (!$ok) {
        $fallos++;
    }
    echo ($ok ? 'ok     ' : 'FALLA  ') . $nombre . ($ok ? '' : "  $detalle") . "\n";
}

$n = 0;
function nuevo(string $tmp, string $jwksJson, int $AHORA, array $V, ?int &$fetches = null, ?object $jti = null): Verificador
{
    static $i = 0;
    $i++;
    $fetches = 0;
    $f = function () use (&$fetches, $jwksJson): string {
        $fetches++;
        return $jwksJson;
    };
    $reloj = fn () => $AHORA;
    $cache = new JwksCache($f, "$tmp/jwks-$i.json", 3600, 10, $reloj);
    return new Verificador($cache, $V['iss'], $V['aud_esperada'], $jti ?? new MemoriaJtiStore(), $reloj);
}

// --- 1. Todos los vectores
foreach ($V['casos'] as $nombre => $c) {
    $ver = nuevo($tmp, $jwksJson, $AHORA, $V);
    $r = $ver->verificar($c['token'], $c['use_esperado']);
    if ($nombre === 'jti_repetido') {
        $r2 = $ver->verificar($c['token'], $c['use_esperado']);
        t("vector $nombre (1a ok, 2a jti)", $r['ok'] && !$r2['ok'] && $r2['motivo'] === 'jti');
        continue;
    }
    $obtenido = $r['ok'] ? 'ok' : $r['motivo'];
    t("vector $nombre -> {$c['esperado']}", $obtenido === $c['esperado'], "obtuvo $obtenido");
    if ($nombre === 'email_mayusculas') {
        t('email normalizado a minusculas', ($r['claims']['email'] ?? '') === 'ana.perez@ecologia.test');
    }
}

// --- 2. jti solo para login: un pase de acceso se puede repetir
$ver = nuevo($tmp, $jwksJson, $AHORA, $V);
$ta = $V['casos']['valido_acceso']['token'];
t('acceso repetible (sin jti)', $ver->verificar($ta, 'acceso')['ok'] && $ver->verificar($ta, 'acceso')['ok']);

// --- 3. Cache JWKS
$fe = 0;
$ver = nuevo($tmp, $jwksJson, $AHORA, $V, $fe);
$ver->verificar($V['casos']['valido_acceso']['token'], 'acceso');
$ver->verificar($V['casos']['valido_acceso']['token'], 'acceso');
$ver->verificar($V['casos']['firma_ajena']['token'], 'login');
t('JWKS en cache: 1 sola descarga con kid conocido', $fe === 1, "fetches=$fe");

$fe = 0;
$ver = nuevo($tmp, $jwksJson, $AHORA, $V, $fe);
$r = $ver->verificar($V['casos']['kid_desconocido']['token'], 'login');
t('kid desconocido: refresca una vez y falla por firma', $fe === 2 && $r['motivo'] === 'firma', "fetches=$fe");

// vencimiento del cache a la hora
$fe = 0;
$t0 = $AHORA;
$reloj = function () use (&$t0) { return $t0; };
$cache = new JwksCache(function () use (&$fe, $jwksJson) { $fe++; return $jwksJson; }, "$tmp/ttl.json", 3600, 10, $reloj);
$cache->clave('PRUEBA-1');
$t0 += 3500;
$cache->clave('PRUEBA-1');
$ok1 = $fe === 1;
$t0 += 200;
$cache->clave('PRUEBA-1');
t('cache JWKS dura 1 h', $ok1 && $fe === 2, "fetches=$fe");

// portal caido con cache vencido: se sigue con la cache
$t0 += 7200;
$cacheCaido = new JwksCache(function () { throw new RuntimeException('caido'); }, "$tmp/ttl.json", 3600, 10, $reloj);
t('portal caido: usa cache previa', $cacheCaido->clave('PRUEBA-1') !== null);

// --- 4. Almacenes de jti
$s = new ArchivoJtiStore("$tmp/jti");
t('ArchivoJtiStore: 1a true, 2a false', $s->usar('x1', $AHORA + 60) && !$s->usar('x1', $AHORA + 60) && $s->usar('x2', $AHORA));
if (extension_loaded('pdo_sqlite')) {
    $pdo = new PDO('sqlite::memory:');
    $pdo->exec('CREATE TABLE sso_jti_usados (jti VARCHAR(128) PRIMARY KEY, expira_en BIGINT NOT NULL)');
    $s = new PdoJtiStore($pdo);
    t('PdoJtiStore: 1a true, 2a false', $s->usar('y1', 1) && !$s->usar('y1', 1) && $s->usar('y2', 1));
    $ver = nuevo($tmp, $jwksJson, $AHORA, $V, $fe, new PdoJtiStore($pdo));
    $tl = $V['casos']['valido_login']['token'];
    t('vector login con PdoJtiStore (1a ok, 2a jti)', $ver->verificar($tl, 'login')['ok'] && ($ver->verificar($tl, 'login')['motivo'] ?? '') === 'jti');
}
$ver = new Verificador(new JwksCache(fn () => $jwksJson, "$tmp/sinjti.json", 3600, 10, fn () => $AHORA), $V['iss'], $V['aud_esperada'], null, fn () => $AHORA);
t('login sin JtiStore configurado: rechaza (no abre por omision)', ($ver->verificar($V['casos']['valido_login']['token'], 'login')['motivo'] ?? '') === 'jti');

// --- 5. Rutas
$usuarios = [
    'ana.perez@ecologia.test' => ['id' => 7, 'rol' => 'admin', 'activo' => true],
    'inactivo@ecologia.test' => ['id' => 8, 'activo' => false],
];
$buscadas = [];
$buscar = function (string $email) use ($usuarios, &$buscadas): ?array {
    $buscadas[] = $email;
    return $usuarios[$email] ?? null;
};
$sesiones = [];
$logs = [];
$rutas = function (array $extra = []) use ($tmp, $jwksJson, $AHORA, $V, $buscar, &$sesiones, &$logs): Rutas {
    return new Rutas($extra + [
        'verificador' => nuevo($tmp, $jwksJson, $AHORA, $V),
        'buscarUsuario' => $buscar,
        'abrirSesion' => function (array $u, array $c) use (&$sesiones) { $sesiones[] = [$u, $c]; },
        'urlInicio' => '/inicio',
        'urlPortal' => 'https://portal.prueba.invalid/',
        'log' => function (string $e, string $m) use (&$logs) { $logs[] = "$e:$m"; },
    ]);
};
$tokL = $V['casos']['valido_login']['token'];
$tokA = $V['casos']['valido_acceso']['token'];

$r = $rutas()->acceso("Bearer $tokA");
t('acceso 200 acceso:true con rol', $r['status'] === 200 && json_decode($r['body'], true) === ['acceso' => true, 'rol' => 'admin']);
t('acceso sin cache', str_contains($r['headers']['Cache-Control'], 'no-store'));
$r = $rutas()->acceso(null);
t('acceso sin pase 401', $r['status'] === 401);
$r = $rutas()->acceso('Bearer ' . $V['casos']['vencido']['token']);
t('acceso pase vencido 401 sin revelar motivo', $r['status'] === 401 && !str_contains($r['body'], 'exp'));
$r = $rutas()->acceso("Bearer $tokL");
t('acceso con pase use=login 401', $r['status'] === 401);
$r = $rutas()->acceso('Bearer ' . $V['casos']['alg_none']['token']);
t('acceso alg=none 401', $r['status'] === 401);
$r = $rutas()->acceso('Basic abc');
t('acceso esquema distinto de Bearer 401', $r['status'] === 401);

// correo sin usuario / inactivo -> acceso:false (200)
$cambiar = fn (string $email) => $rutas(['buscarUsuario' => fn (string $e) => $buscar($email)]);
$r = $cambiar('nadie@ecologia.test')->acceso("Bearer $tokA");
t('acceso sin usuario 200 acceso:false', $r['status'] === 200 && $r['body'] === '{"acceso":false}');
$r = $cambiar('inactivo@ecologia.test')->acceso("Bearer $tokA");
t('acceso usuario inactivo 200 acceso:false', $r['status'] === 200 && $r['body'] === '{"acceso":false}');

$buscadas = [];
$rt = $rutas();
$r = $rt->login($V['casos']['email_mayusculas']['token']);
t('login con correo en mayusculas: 302 y busca en minusculas', $r['status'] === 302 && $buscadas === ['ana.perez@ecologia.test'], json_encode($buscadas));
t('login 302 va al inicio y abre sesion', ($r['headers']['Location'] ?? '') === '/inicio' && count($sesiones) === 1 && $sesiones[0][0]['id'] === 7);
t('login sin cache', str_contains($r['headers']['Cache-Control'], 'no-store'));

$rt = $rutas();
$a = $rt->login($tokL);
$b = $rt->login($tokL);
t('login: 1a 302, replay 403', $a['status'] === 302 && $b['status'] === 403);
t('replay 403 sin revelar motivo', !str_contains($b['body'], 'jti') && str_contains($b['body'], 'portal.prueba.invalid'));
t('motivo llega al log, no al cliente', end($logs) === 'login:jti');
foreach (['basura', 'hs256', 'alg_none', 'firma_ajena', 'aud_ajeno', 'iss_ajeno', 'vencido', 'use_cambiado'] as $k) {
    $n0 = count($sesiones);
    $r = $rutas()->login($V['casos'][$k]['token']);
    t("login $k -> 403 sin sesion", $r['status'] === 403 && count($sesiones) === $n0);
}
t('login sin token 403', $rutas()->login(null)['status'] === 403 && $rutas()->login('')['status'] === 403);
$r = $cambiar('nadie@ecologia.test')->login($tokL);
t('login sin usuario 403', $r['status'] === 403);
$r = $cambiar('inactivo@ecologia.test')->login($tokL);
t('login usuario inactivo 403', $r['status'] === 403);
t('pase use=acceso no abre sesion en login', $rutas()->login($tokA)['status'] === 403);
t('ningun log contiene el pase', count(array_filter($logs, fn ($l) => str_contains($l, 'eyJ'))) === 0);

// atender(): metodo/ruta
$_SERVER['REQUEST_METHOD'] = 'GET';
ob_start();
$rutas()->atender('/sso/login');
ob_end_clean();
t('GET /sso/login -> 405 (el pase nunca va por URL)', http_response_code() === 405 || PHP_SAPI === 'cli');

// --- 6. Endurecimiento (revision de seguridad)
$pem = file_get_contents("$dirV/clave-privada.PRUEBA.pem");
$b64u = fn (string $x): string => rtrim(strtr(base64_encode($x), '+/', '-_'), '=');
$firmar = function (array $over = [], array $quitar = []) use ($pem, $b64u, $V, $AHORA): string {
    $iat = $AHORA - 5;
    $c = array_merge([
        'iss' => $V['iss'], 'aud' => $V['aud_esperada'], 'sub' => 'emp-1001', 'email' => 'ana.perez@ecologia.test',
        'use' => 'login', 'iat' => $iat, 'exp' => $iat + 60, 'jti' => 'jti-h-' . bin2hex(random_bytes(6)),
    ], $over);
    foreach ($quitar as $k) {
        unset($c[$k]);
    }
    $h = $b64u(json_encode(['alg' => 'RS256', 'kid' => 'PRUEBA-1', 'typ' => 'JWT']));
    $b = $b64u(json_encode($c));
    openssl_sign("$h.$b", $sig, $pem, OPENSSL_ALGO_SHA256);
    return "$h.$b." . $b64u($sig);
};
$res = fn (string $tok): string => ($r = nuevo($tmp, $jwksJson, $AHORA, $V)->verificar($tok, 'login'))['ok'] ? 'ok' : $r['motivo'];

t('firmador propio: pase valido', $res($firmar()) === 'ok');
t('aud como arreglo -> aud', $res($firmar(['aud' => [$V['aud_esperada']]])) === 'aud');
t('iat ausente -> rechazado', $res($firmar([], ['iat'])) === 'exp');
t('iat no numerico -> rechazado', $res($firmar(['iat' => (string) ($AHORA - 5)])) === 'exp');
t('iat futuro (+61 s) -> rechazado', $res($firmar(['iat' => $AHORA + 61, 'exp' => $AHORA + 100])) === 'exp');
t('iat futuro dentro de 60 s -> ok', $res($firmar(['iat' => $AHORA + 50, 'exp' => $AHORA + 110])) === 'ok');
t('exp - iat > vida maxima -> rechazado', $res($firmar(['iat' => $AHORA - 5, 'exp' => $AHORA + 3595])) === 'exp');
t('exp - iat = 60 -> ok', $res($firmar(['iat' => $AHORA - 5, 'exp' => $AHORA + 55])) === 'ok');

foreach (['http://portal.ejemplo.invalid/jwks.json', 'ftp://x.invalid/j', 'no es url', '', '//portal.invalid/j'] as $u) {
    $lanzo = false;
    try {
        JwksCache::fetcherHttp($u);
    } catch (InvalidArgumentException) {
        $lanzo = true;
    }
    t("fetcherHttp rechaza '$u'", $lanzo);
}
$acepto = true;
foreach (['https://portal.ejemplo.invalid/j', 'http://localhost/j', 'http://127.0.0.1:8080/j', 'http://[::1]:8080/j'] as $u) {
    try {
        JwksCache::fetcherHttp($u);
    } catch (Throwable) {
        $acepto = false;
    }
}
try {
    JwksCache::fetcherHttp('http://portal.ejemplo.invalid/j', true);
} catch (Throwable) {
    $acepto = false;
}
t('fetcherHttp acepta https, localhost y permitirHttp', $acepto);

// ejemplo/sso.php: directorio de estado
$ejecutar = function (?string $dir) use ($tmp): string {
    $env = ['PATH' => getenv('PATH') ?: '/usr/local/bin', 'SSO_JWKS_URL' => 'https://portal.prueba.invalid/j'];
    if ($dir !== null) {
        $env['SSO_ESTADO_DIR'] = $dir;
    }
    $p = proc_open([PHP_BINARY, __DIR__ . '/../ejemplo/sso.php'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
    $out = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
    proc_close($p);
    return $out;
};
t('ejemplo: sin SSO_ESTADO_DIR aborta', str_contains($ejecutar(null), 'falta SSO_ESTADO_DIR'));
mkdir("$tmp/abierto", 0755);
chmod("$tmp/abierto", 0755);
t('ejemplo: directorio 0755 aborta', str_contains($ejecutar("$tmp/abierto"), 'modo 0700'));
mkdir("$tmp/cerrado", 0700);
chmod("$tmp/cerrado", 0700);
$o = $ejecutar("$tmp/cerrado");
t('ejemplo: directorio 0700 propio pasa la verificacion', !str_contains($o, 'SSO_ESTADO_DIR'), $o);
symlink("$tmp/cerrado", "$tmp/enlace");
t('ejemplo: enlace simbolico aborta', str_contains($ejecutar("$tmp/enlace"), 'no es un directorio propio'));

// --- 7. CSRF de login (origenPortal) y JWKS vacio
$portal = 'https://portal.prueba.invalid';
$rc = fn (array $extra = []) => $rutas(['origenPortal' => $portal] + $extra);
$r = $rc()->login($tokL, $portal, 'cross-site');
t('CSRF: POST autoenviado del portal (Origin del portal, cross-site) -> 302', $r['status'] === 302);
foreach (['https://atacante.invalid', 'null', 'https://portal.prueba.invalid.atacante.invalid', 'http://portal.prueba.invalid'] as $o) {
    $n0 = count($sesiones);
    $r = $rc()->login($V['casos']['valido_login']['token'], $o, 'cross-site');
    t("CSRF: Origin '$o' -> 403 sin sesion", $r['status'] === 403 && count($sesiones) === $n0);
}
$n0 = count($sesiones);
t('CSRF: sin Origin y Sec-Fetch-Site cross-site -> 403', $rc()->login($tokL, null, 'cross-site')['status'] === 403 && count($sesiones) === $n0);
t('CSRF: sin Origin y same-origin -> 302', $rc()->login($tokL, null, 'same-origin')['status'] === 302);
t('CSRF: sin cabeceras (cliente sin Origin) -> 302', $rc()->login($tokL)['status'] === 302);

$fe2 = 0;
$modo = 'bueno';
$relojJ = function () use (&$t1) { return $t1; };
$t1 = $AHORA;
$fetchJ = function () use (&$modo, $jwksJson) {
    return match ($modo) { 'bueno' => $jwksJson, 'vacio' => '{"keys":[]}', default => '{"keys":[{"kty":"EC"}]}' };
};
$cj = new JwksCache($fetchJ, "$tmp/vacio.json", 3600, 10, $relojJ);
$cj->clave('PRUEBA-1');
foreach (['vacio', 'invalido'] as $modo) {
    $t1 += 4000; // cache vencido: intenta refrescar
    t("JWKS $modo no pisa el cache anterior", $cj->clave('PRUEBA-1') !== null);
}
$guardado = json_decode((string) file_get_contents("$tmp/vacio.json"), true);
t('JWKS: el archivo de cache sigue con las claves buenas', isset($guardado['keys']['PRUEBA-1']));

// --- 8. Catch-all de Rutas (sin stack ni rutas; solo la clase en el log)
$boom = function (string $e) { throw new RuntimeException('secreto /var/www/privado.php'); };
$logs = [];
$r = $rutas(['buscarUsuario' => $boom])->acceso("Bearer $tokA");
t('catch-all: acceso con excepcion -> 401 JSON generico', $r['status'] === 401 && $r['body'] === '{"error":"no autorizado"}');
$r = $rutas(['buscarUsuario' => $boom])->login($tokL);
t('catch-all: login con excepcion -> 403 pagina sin acceso', $r['status'] === 403 && str_contains($r['body'], 'Sin acceso'));
t('catch-all: respuesta sin stack ni rutas', !str_contains($r['body'], 'privado') && !str_contains($r['body'], '.php'));
t('catch-all: log solo con la clase', in_array('acceso:error:RuntimeException', $logs, true) && in_array('login:error:RuntimeException', $logs, true)
    && !array_filter($logs, fn ($l) => str_contains($l, 'secreto')));
$r = $rutas(['abrirSesion' => function () { throw new Error('x'); }])->login($tokL);
t('catch-all: Error (no Exception) en abrirSesion -> 403', $r['status'] === 403);
$r = $rutas(['log' => function () { throw new RuntimeException('log roto'); }, 'buscarUsuario' => $boom])->login($tokL);
t('catch-all: un log que falla no rompe la respuesta', $r['status'] === 403);

// --- 9. Origen: puerto por defecto normalizado
foreach ([
    ['https://portal.prueba.invalid:443', 'https://portal.prueba.invalid', 302],
    ['https://portal.prueba.invalid', 'https://portal.prueba.invalid:443', 302],
    ['https://portal.prueba.invalid:8443', 'https://portal.prueba.invalid', 403],
    ['https://portal.prueba.invalid', 'https://portal.prueba.invalid:8443', 403],
    ['http://portal.prueba.invalid:80', 'http://portal.prueba.invalid', 302],
    ['https://portal.prueba.invalid', 'https://portal.prueba.invalid/ruta', 403],
    ['https://portal.prueba.invalid', 'https://x@portal.prueba.invalid', 403],
] as [$conf, $origin, $esp]) {
    $r = $rutas(['origenPortal' => $conf])->login($V['casos']['valido_login']['token'], $origin, 'cross-site');
    t("origen: config '$conf' vs Origin '$origin' -> $esp", $r['status'] === $esp);
}

// --- 10. ArchivoJtiStore verifica dueno y modo del directorio
$d = "$tmp/jti-laxo";
mkdir($d, 0700);
chmod($d, 0755);
$lanzo = false;
try { new ArchivoJtiStore($d); } catch (RuntimeException $e) { $lanzo = true; }
t('ArchivoJtiStore: directorio 0755 -> excepcion', $lanzo);
chmod($d, 0700);
$lanzo = false;
try { new ArchivoJtiStore($d); } catch (RuntimeException $e) { $lanzo = true; }
t('ArchivoJtiStore: directorio 0700 propio -> ok', !$lanzo);
symlink($d, "$tmp/jti-enlace");
$lanzo = false;
try { new ArchivoJtiStore("$tmp/jti-enlace"); } catch (RuntimeException $e) { $lanzo = true; }
t('ArchivoJtiStore: enlace simbolico -> excepcion', $lanzo);

echo "\n$total pruebas, $fallos fallas\n";
exit($fallos === 0 ? 0 : 1);
