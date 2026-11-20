# Kit SSO para PHP

Verifica el pase del portal (JWT RS256) e implementa `GET /sso/acceso` y `POST /sso/login` segun `docs/sso/CONTRATO.md`.
Sin framework ni Composer: PHP >= 8.1 con las extensiones `openssl` y `json` (y `pdo` solo si usas `PdoJtiStore`).
La firma se verifica con `openssl_verify` a partir del JWKS (no hay dependencia de firebase/php-jwt).

## Contenido

- `src/Verificador.php` verificacion en el orden fijo del contrato. Devuelve `ok` o el motivo (`formato|alg|firma|iss|aud|exp|use|jti`). Los motivos van al log, nunca al cliente.
- `src/JwksCache.php` cache de JWKS en archivo, 1 h; ante `kid` desconocido refresca una vez (con freno de 10 s entre refrescos forzados). Si el portal esta caido sigue con la cache.
- `src/JtiStore.php` interfaz de un solo uso. Implementaciones: `ArchivoJtiStore` (sin BD), `PdoJtiStore` (tabla), `MemoriaJtiStore` (solo pruebas). Se puede enchufar cualquier otra (Redis, APCu) implementando `usar(jti, expiraEn): bool` de forma atomica.
- `src/Rutas.php` las dos rutas. `ejemplo/sso.php` es un punto de entrada completo con `buscarUsuarioPorCorreo` de ejemplo.

## Copiarlo a Licencias de pesca / Registro de infractores

1. Copiar la carpeta `src/` al sistema, p. ej. `<sistema>/sso/src/`, y `ejemplo/sso.php` como `<sistema>/sso/sso.php`. Ajustar el `require` del autoload.
2. En `sso.php`, adaptar a ese sistema (es lo unico propio de cada uno):
   - `buscarUsuarioPorCorreo($email)`: recibe el correo en minusculas, devuelve `['id'=>, 'rol'=>(opcional), 'activo'=>bool]` o `null`. Si el correo aparece mas de una vez, devolver `null`.
   - `abrirSesion($usuario, $claims)`: abrir la sesion propia (la misma que hoy abre su login). No se toca ni se desactiva el login existente.
3. Enrutar `/sso/acceso` y `/sso/login` a ese archivo. Apache: `RewriteRule ^sso/(acceso|login)/?$ sso/sso.php [L]` y, para que llegue el header Bearer con PHP-FPM/CGI, `RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]`. Nginx: pasar `fastcgi_param HTTP_AUTHORIZATION $http_authorization;`.
4. Variables de entorno:
   - `SSO_ISSUER` igual al `iss` del portal; `SSO_JWKS_URL` (`https://<portal>/.well-known/jwks.json`); `SSO_AUDIENCE` = id de este sistema en `sso_sistemas` (`pesca`, `infractores`, ...); `PORTAL_URL`; `SISTEMA_URL_INICIO`; `SSO_ESTADO_DIR` (**obligatorio**, sin valor por defecto: directorio **fuera del webroot**, de propiedad del usuario que corre PHP y con modo `0700`; `ejemplo/sso.php` aborta con 500 si falta, es un enlace simbolico, no es del usuario actual o no es 0700. Nunca usar `/tmp` compartido). `SSO_PERMITIR_HTTP=1` solo en desarrollo.
5. Registrar el sistema en `sso_sistemas` del portal con `url_login` = `https://<sistema>/sso/login` y `url_acceso` = `https://<sistema>/sso/acceso`.
6. Produccion solo por HTTPS. Si hay varios servidores detras de un balanceador, usar `PdoJtiStore` (o Redis) para que el jti sea compartido; `ArchivoJtiStore` solo sirve con un unico servidor/disco.

## Pruebas

Sin PHP local, con Docker, desde cualquier carpeta:

    kit/php/tests/correr.sh

(ejecuta `php tests/run.php` en `php:8.3-cli` con la raiz del repo montada en solo lectura; usa `docs/sso/vectores/` y el reloj fijo `ahora`). Cubre todos los vectores, jti de un solo uso, cache JWKS (1 h, refresco por kid desconocido, portal caido), almacenes de jti y las rutas (200/401, 302/403, sin cache, motivos fuera de la respuesta).

## Notas de seguridad

- `JwksCache::fetcherHttp($url, $permitirHttp)` rechaza `SSO_JWKS_URL` que no sea `https://` (salvo localhost/127.0.0.1/::1 o `$permitirHttp = true`, solo desarrollo).
- Claims: `aud` string igual al id; `iat` numerico y no futuro (tolerancia 60 s); `exp - iat` <= 60 s mas la tolerancia de 60 s (los vectores oficiales traen un pase de 80 s). Fallos de tiempo: motivo `exp`.
- Solo RS256; `alg` distinto se rechaza antes de tocar la firma. Se exige `iss` y `aud` exactos.
- `/sso/acceso` responde 401 ante cualquier pase ausente, invalido o de `use=login`. Con pase valido: 200 `acceso:true|false`.
- Sin `JtiStore` configurado, `login` rechaza todo (falla cerrado).
- No se registran pases ni claves; el log recibe solo evento y motivo.
- Las respuestas llevan `Cache-Control: no-store`. El pase solo se acepta por POST (`$_POST['token']`); `GET /sso/login` da 405.

## Defensa CSRF de `login` (`origenPortal`)
`new Rutas([... 'origenPortal' => 'https://portal...'])` (def.: el origen de `urlPortal`). `login($token, $origin, $secFetchSite)` (con `atender()` se toman de `HTTP_ORIGIN` y `HTTP_SEC_FETCH_SITE`): con `Origin` debe ser igual al del portal; sin `Origin` se rechaza `Sec-Fetch-Site: cross-site`; sin ninguna de las dos se acepta (clientes sin cabeceras). Fallo -> 403 como cualquier otro. El POST autoenviado del portal llega con `Origin: <origen del portal>` y pasa. **`Origin: null` se rechaza** (sandbox, redirecciones cross-origin y formularios de páginas con `Referrer-Policy: no-referrer`): la página del portal que autoenvía el formulario debe usar `strict-origin` u `origin`, no `no-referrer`.
`JwksCache` ya no sobrescribe el cache con un JWKS vacío o sin claves RSA válidas: conserva el anterior.

## Errores, origen y almacén de archivos
- `Rutas::acceso()`, `login()` y `atender()` capturan `\Throwable`: `login` responde la página 403 "sin acceso", `acceso` responde 401 JSON genérico (y `atender`, 500 vacío si falla fuera de ambas), sin stack ni rutas. Al log solo llega la clase de la excepción (`error:RuntimeException`).
- `origenPortal`/`urlPortal` y el header `Origin` se comparan normalizados: el puerto por defecto se ignora (`https://portal:443` == `https://portal`); un `Origin` con ruta o usuario se rechaza.
- `ArchivoJtiStore` verifica por sí mismo que el directorio sea propio (no enlace simbólico), del usuario actual y modo `0700`; si no, el constructor lanza `RuntimeException`.
- `ejemplo/sso.php` vacía `$_SESSION` tras `session_regenerate_id(true)`.
