<?php
declare(strict_types=1);

/**
 * EJEMPLO de punto de entrada /sso/*. Copiar y adaptar en cada sistema.
 * Configuracion por variables de entorno (nunca URLs en el codigo).
 */
require __DIR__ . '/../src/autoload.php';

use Ministerio\Sso\ArchivoJtiStore;
use Ministerio\Sso\JwksCache;
use Ministerio\Sso\Rutas;
use Ministerio\Sso\Verificador;

/**
 * LO UNICO QUE CADA SISTEMA IMPLEMENTA.
 * Recibe el correo ya en minusculas. Devuelve ['id'=>..., 'rol'=>... (opcional), 'activo'=>bool] o null.
 * La usan /sso/acceso y /sso/login (misma funcion en ambas, como pide el contrato).
 * Ejemplo con PDO: ADAPTAR tabla y columnas a cada sistema.
 */
function buscarUsuarioPorCorreo(string $email): ?array
{
    $pdo = new PDO(getenv('DB_DSN') ?: '', getenv('DB_USER') ?: null, getenv('DB_PASS') ?: null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
    $st = $pdo->prepare('SELECT id, rol, activo FROM usuarios WHERE LOWER(correo) = ? LIMIT 2');
    $st->execute([$email]);
    $filas = $st->fetchAll(PDO::FETCH_ASSOC);
    if (count($filas) !== 1) { // 0 = no existe; >1 = ambiguo: no abrir
        return null;
    }
    return ['id' => $filas[0]['id'], 'rol' => $filas[0]['rol'] ?: null, 'activo' => (bool) $filas[0]['activo']];
}

/** Abre la sesion PROPIA del sistema (aca va lo que hoy hace el login del sistema tras validar clave). */
function abrirSesion(array $usuario, array $claims): void
{
    session_set_cookie_params(['httponly' => true, 'secure' => true, 'samesite' => 'Lax']);
    session_start();
    session_regenerate_id(true);
    $_SESSION = []; // descarta todo dato previo de la sesion (fijacion/herencia) tras regenerar el id
    $_SESSION['usuario_id'] = $usuario['id'];   // ADAPTAR a las claves de sesion del sistema
    $_SESSION['rol'] = $usuario['rol'] ?? null;
}

/**
 * Directorio de estado (cache JWKS y jti): obligatorio por SSO_ESTADO_DIR, fuera del webroot y
 * SIN valor por defecto (un /tmp compartido permite que otro usuario plante archivos).
 * Debe ser de este usuario y modo 0700; si no, se aborta antes de usarlo.
 */
function directorioEstado(): string
{
    $dir = getenv('SSO_ESTADO_DIR') ?: '';
    $fallar = static function (string $m): never {
        error_log("sso: $m");
        http_response_code(500);
        exit;
    };
    if ($dir === '') {
        $fallar('falta SSO_ESTADO_DIR');
    }
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        $fallar('no se pudo crear SSO_ESTADO_DIR');
    }
    clearstatcache(true, $dir);
    if (is_link($dir) || !is_dir($dir)) {
        $fallar('SSO_ESTADO_DIR no es un directorio propio');
    }
    $uid = function_exists('posix_geteuid') ? posix_geteuid() : getmyuid();
    if (fileowner($dir) !== $uid) {
        $fallar('SSO_ESTADO_DIR no pertenece al usuario actual');
    }
    if ((fileperms($dir) & 0777) !== 0700) {
        $fallar('SSO_ESTADO_DIR debe tener modo 0700');
    }
    return $dir;
}

$estado = directorioEstado();
// p.ej. https://portal.../.well-known/jwks.json. http solo en localhost, o SSO_PERMITIR_HTTP=1 (solo desarrollo).
$jwksUrl = getenv('SSO_JWKS_URL') ?: '';

$jwks = new JwksCache(
    JwksCache::fetcherHttp($jwksUrl, getenv('SSO_PERMITIR_HTTP') === '1'),
    $estado . '/jwks.json',
);

$rutas = new Rutas([
    'verificador' => new Verificador(
        $jwks,
        getenv('SSO_ISSUER') ?: '',
        getenv('SSO_AUDIENCE') ?: '',          // id de este sistema en el portal
        new ArchivoJtiStore($estado . '/jti'), // o new PdoJtiStore($pdo)
    ),
    'abrirSesion' => 'abrirSesion',
    'urlInicio' => getenv('SISTEMA_URL_INICIO') ?: '/',
    'urlPortal' => getenv('PORTAL_URL') ?: '/',
    'log' => fn (string $evento, string $motivo) => error_log("sso $evento rechazado: $motivo"),
]);
$rutas->atender();
