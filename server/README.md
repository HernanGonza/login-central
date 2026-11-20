# Servidor del portal (server/)

Express + Postgres. Contrato: `docs/sso/CONTRATO.md`. Pruebas: `npm test` (levanta su propio Postgres temporal).

## NODE_ENV (falla cerrado)
Solo `NODE_ENV=development` explícito habilita lo inseguro: semillas de prueba, clave de firma y ALTCHA efímeras,
`TRUST_PROXY=true`, `COOKIE_SECURE=false`, URLs http, `PERSONAL_ADAPTER=prueba`. Cualquier otro valor (production,
staging, vacío) se comporta como producción: exige `SSO_ISSUER` y `PORTAL_URL` https, `ALTCHA_HMAC_KEY`, cookie Secure,
y envía HSTS. `url_login`/`url_acceso` de `sso_sistemas` deben ser https (http solo en desarrollo o hacia localhost);
las filas inválidas se ignoran y se registra solo su id.

## Variables
| Variable | Default | Uso |
|---|---|---|
| `TRUST_PROXY` | (vacío) | Ver abajo |
| `ALTCHA_HMAC_KEY` | obligatoria fuera de desarrollo | Clave HMAC de ALTCHA |
| `ALTCHA_MAXNUMBER` | 1000000 | Dificultad (peor caso ~1,4 s en Node; el widget lo resuelve en pocos segundos) |
| `ALTCHA_LIMITE_IP_MIN` | 30 | Pedidos/min a `/api/altcha` por IP |
| `LIMITE_VENTANA_SEG` | 900 | Ventana de los límites de ingreso |
| `LIMITE_POR_PAR` | 5 | Fallos por par (correo, IP) en la ventana: bloquea solo ese par |
| `LIMITE_POR_IP` | 20 | Fallos por IP (muchos correos desde una IP) |
| `LIMITE_POR_CORREO` | 50 | Tope GLOBAL por correo (adivinanza distribuida masiva) |
| `LIMITE_ENTRAR_MIN` | 30 | `POST /api/entrar/:id` por sesión y minuto |
| `LIMITE_FORZAR_MIN` | 6 | Tarjetas con `forzar=1` por sesión y minuto |
| `PURGA_INTERVALO_SEG` / `JTI_RETENCION_DIAS` | 600 / 30 | Purga de sesiones, jti, intentos y altcha_usados |

Todos los números deben ser enteros positivos; un valor inválido (`abc`, `0`, `-1`) aborta el arranque.

## TRUST_PROXY
Define de quién se confía `X-Forwarded-For` para obtener `req.ip` (base de los límites por IP). Valores:
número de saltos (`1` = un proxy delante), o lista de IPs/CIDR/alias separados por comas
(`10.0.0.5,192.168.0.0/16,loopback`). `true` (confiar en todo) se rechaza salvo `NODE_ENV=development`: permitiría
falsear la IP y esquivar los límites. Sin proxy delante, dejalo vacío. Las IPv6 se agrupan por /64 al contar límites.

## Límites de ingreso: trade-off
El intento se reserva (fila `pendiente`) antes de verificar la clave, de forma atómica con el conteo
(advisory locks por correo, IP y par), por lo que ingresos concurrentes no superan el límite.
- Par (correo, IP): 5 fallos/15 min bloquean solo ese par. Quien ataca desde otra IP no bloquea a la víctima, y la
  víctima no queda bloqueada por intentos ajenos.
- IP: 20 fallos/15 min cubre adivinanza contra muchos correos desde una IP.
- Correo global (50): freno contra adivinanza distribuida masiva. Costo: un atacante con muchas IPs que acierte a
  acumular 50 fallos sobre un correo puede dejar sin ingreso a esa persona durante la ventana. Se fijó alto para que
  unos pocos intentos ajenos no la afecten; bajarlo endurece contra distribuido pero facilita ese bloqueo dirigido.
- Un ingreso exitoso borra los fallos de su par (no los de otras IPs).
- Los pedidos a `/api/altcha`, `/api/entrar` y `forzar=1` se limitan en memoria por instancia.

## Cabeceras y CSP
CSP `default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' <orígenes de url_login activos>`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin` (el POST autoenviado a los sistemas lleva `Origin` del portal;
con `no-referrer` iría `Origin: null`), `nosniff` y HSTS fuera de desarrollo. Esto aplica a las respuestas de la API.
El HTML de la SPA lo sirve quien hospede `web/`: debe llevar una CSP equivalente con `form-action` hacia los url_login.

## Variables de producción (tabla completa)
| Variable | Default | Notas |
|---|---|---|
| `NODE_ENV` | (vacío = producción) | `development` solo en local |
| `PORT` | 3000 | |
| `DATABASE_URL` | obligatoria | Base propia del portal |
| `SSO_ISSUER` | obligatoria, https | Puede llevar path; el `iss` se emite exactamente igual |
| `PORTAL_URL` | obligatoria, https | Puede llevar path; el anti-CSRF compara solo su origen (esquema+host+puerto) |
| `PORTAL_BASE_PATH` | `/` | Path de la cookie de sesión (p. ej. `/portal`): no viaja a otras apps del dominio. Empieza con `/`, sin `..`, `//` ni caracteres especiales |
| `SSO_PRIVATE_KEY_PATH` / `SSO_PRIVATE_KEY` / `SSO_KID` | obligatoria una de las dos claves | RS256 |
| `ALTCHA_HMAC_KEY` | obligatoria | Mínimo 32 caracteres en producción |
| `ALTCHA_MAXNUMBER` | 1000000 | 10000 a 10000000 en producción |
| `ALTCHA_LIMITE_IP_MIN`, `LIMITE_ENTRAR_MIN`, `LIMITE_FORZAR_MIN`, `LIMITE_POR_PAR`, `LIMITE_POR_IP`, `LIMITE_POR_CORREO` | ver arriba | 1 a 10000 en producción |
| `LIMITE_VENTANA_SEG` | 900 | 60 a 86400 en producción |
| `TARJETAS_TIMEOUT_MS` / `TARJETAS_CACHE_SEG` | 3000 / 600 | 200-10000 / 1-3600 |
| `PURGA_INTERVALO_SEG` / `JTI_RETENCION_DIAS` | 600 / 30 | 10-86400 / 1-3650 |
| `TRUST_PROXY` | (vacío) | Ver abajo |
| `COOKIE_SECURE` | activo | `false` solo en desarrollo |
| `PERSONAL_ADAPTER` | `prueba` | |
| `PORTAL_PERMITIR_ADAPTADOR_PRUEBA` | (vacío) | `1` permite `PERSONAL_ADAPTER=prueba` en producción (modo prueba) |
| `PERSONAL_DATABASE_URL` | (la del portal) | Base de Personal de prueba, si es otra |
| `PERSONAL_REGISTRO_URL` / `PERSONAL_RECUPERO_URL` | vacío | https o mailto |

`server/.env.example` trae un ejemplo de producción con valores ficticios.

## Modo prueba en producción (temporal)
Con `PERSONAL_ADAPTER=prueba` y `PORTAL_PERMITIR_ADAPTADOR_PRUEBA=1`: aviso visible en el log al arrancar,
no se siembran usuarios ni sistemas, se crea la tabla `empleados` si no existe (idempotente) y `/api/config`
devuelve `modo_prueba: true` (la UI muestra un aviso). Sin el permiso, el arranque falla.

## Operación sin semillas (scripts npm; todos aceptan `--help`)
Usan el mismo `DATABASE_URL`/config del servidor (por ejemplo `docker compose exec portal npm run ...`). Ninguno imprime secretos.
- `npm run usuarios:crear -- --email X --nombre N --apellido A [--generar | --clave-stdin]`: argon2id, correo en minúsculas, rechaza duplicados. `--generar` imprime la clave una sola vez; por defecto la pide sin eco; mínimo 10 caracteres.
- `npm run usuarios:listar` (sin hashes), `npm run usuarios:desactivar -- --email X`.
- `npm run sistemas:cargar -- ruta.json`: upsert de `[{id,nombre,descripcion,icono,url_login,url_acceso,siempre_visible,activo}]`, http(s) (solo https en producción), todo o nada.
- `npm run sistemas:listar`.

## TRUST_PROXY: producción con dos saltos
Cadena: cliente, nginx de ecodatos, nginx del portal, API. Usar `TRUST_PROXY=2`. Ambos nginx deben usar
`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (agregar, no pisar con `$remote_addr`). La API recibe
`XFF: <cliente>, <ip ecodatos>` y el socket es el nginx del portal: con 2 saltos `req.ip` es el cliente, y un XFF falso
enviado por el cliente queda a la izquierda y se ignora (cubierto por prueba). Se rechazan rangos CIDR más anchos que /8 (IPv4) o /16 (IPv6) y entradas que no sean saltos, alias (`loopback`, `linklocal`, `uniquelocal`) o IP/CIDR.

## Despliegue bajo un path (`/portal/`)
El nginx de ecodatos quita el prefijo y la API ve `/api/...` y `/.well-known/jwks.json`. La cookie lleva `Path=$PORTAL_BASE_PATH`.
La API no emite redirects ni URLs absolutas a la raíz del dominio (solo devuelve `url_login` de cada sistema). La SPA (`web/`)
debe construirse con base `/portal/` y llamar a la API con rutas relativas. `iss` = `SSO_ISSUER` tal cual (JWKS en `<SSO_ISSUER>/.well-known/jwks.json`).

## Cambios de la tercera revisión
- Tope global por correo: no bloquea a IPs (clave /64 en IPv6) con un ingreso exitoso de ese correo en los últimos 30 días (se conservan esas filas 30 días). Trade-off: quien comparte IP con un usuario legítimo (NAT) evita el tope global; siguen valiendo los límites por par y por IP.
- `POST /api/*` sin `Origin` se rechaza con `Sec-Fetch-Site: cross-site` (misma regla que los kits).
