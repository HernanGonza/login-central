# Despliegue del portal (login-central) en la VM de ecodatos

Despliegue actual: **https://ecodatos.ecologia.misiones.gob.ar/portal/** (mismo modelo que la Wiki en `/wiki/`).
El prefijo es parametrizable (`PORTAL_BASE_PATH` y `VITE_BASE`) para migrar luego a un subdominio propio (ver el final).
Adaptador de Personal: **de prueba** (la UI muestra la franja "Entorno de prueba").

## 0. Requisitos
- VM de ecodatos con Docker y Docker Compose v2; la red Docker `supabase` ya existe (`docker network ls | grep supabase`).
- Reloj sincronizado (NTP): el pase de ingreso vive 60 s. `timedatectl` debe decir `System clock synchronized: yes`.
- No hay paso de DNS ni de TLS: se usa el dominio de ecodatos. El único paso externo es pegar un bloque en su nginx (paso 8).

## 1. Clonar
```bash
git clone <repositorio> login-central && cd login-central
```

## 2. Configurar `.env`
```bash
cp .env.example .env && chmod 600 .env
openssl rand -base64 36 | tr -d '/+=\n'; echo   # POSTGRES_PASSWORD (sin caracteres especiales: va en una URL)
openssl rand -hex 32                               # ALTCHA_HMAC_KEY
```
Completar `POSTGRES_PASSWORD`, `ALTCHA_HMAC_KEY`, `PERSONAL_REGISTRO_URL`, `PERSONAL_RECUPERO_URL`. El resto de los valores por
defecto ya corresponden a `/portal/`.

## 3. Clave de firma
```bash
deploy/generar-clave.sh      # crea secrets/sso-private.pem (600) y sso-public.pem; no sobrescribe; imprime el kid
```
La clave privada se monta de solo lectura en el contenedor; nunca va al repo ni a la imagen (`secrets/` está en `.gitignore`).
Hacerlo ANTES de levantar: si el archivo no existe, Docker crea un directorio en su lugar.

## 4. Levantar
```bash
docker compose up -d --build
docker compose ps            # portal-db, portal-api y portal-web deben quedar "healthy"
docker compose logs portal-api | tail
```
Ninguno publica puertos al host.

## 5. Cargar sistemas
`./deploy` se monta en el contenedor como `/deploy` (solo lectura).
```bash
cp deploy/sistemas.produccion.ejemplo.json deploy/sistemas.produccion.json   # editar si hace falta
docker compose exec portal-api npm run sistemas:cargar -- /deploy/sistemas.produccion.json
docker compose exec portal-api npm run sistemas:listar
```
El ejemplo solo trae la Wiki (`siempre_visible: true`). No se inventan otros sistemas.

## 6. Usuarios de prueba
```bash
docker compose exec -it portal-api npm run usuarios:crear -- --email ana@ecologia.misiones.gob.ar --nombre Ana --apellido Gomez --generar
```
(`--generar` imprime una clave una sola vez.)

## 7. Variables que necesita la Wiki (después del portal)
En el `.env` de la Wiki: `SSO_ISSUER=https://ecodatos.ecologia.misiones.gob.ar/portal`,
`SSO_JWKS_URL=https://ecodatos.ecologia.misiones.gob.ar/portal/.well-known/jwks.json`,
`SSO_PORTAL_URL=https://ecodatos.ecologia.misiones.gob.ar/portal/` (nombres según el kit de la Wiki).

## 8. nginx de ecodatos
Pegar el contenido activo de `deploy/ecodatos-nginx-portal.conf` (los dos `location`) dentro del `server { }` de
`ecodatos/infra/nginx/nginx.conf`, junto a `/wiki/`; luego:
```bash
docker exec <contenedor-nginx-ecodatos> nginx -t && docker exec <contenedor-nginx-ecodatos> nginx -s reload
```
`portal-web` está en la red `supabase`, por eso el nginx lo resuelve como `portal-web` (igual que `wiki-web`).

## 9. Probar
```bash
curl -s https://ecodatos.ecologia.misiones.gob.ar/portal/.well-known/jwks.json     # una clave RSA, mismo kid que imprimió el script
curl -s https://ecodatos.ecologia.misiones.gob.ar/portal/api/config               # incluye "modo_prueba":true
curl -sI https://ecodatos.ecologia.misiones.gob.ar/portal/ | grep -i -E "content-security|x-frame|referrer|strict"
```
Abrir `/portal/`, ingresar con el usuario de prueba y entrar a la Wiki.

## 10. Orden con la Wiki
1. Portal arriba y verificado (pasos 4 a 9). 2. Recién entonces configurar la Wiki con sus variables `SSO_*` y reconstruirla.

## Troubleshooting
- **502 en /portal/**: el nginx de ecodatos no ve `portal-web`: `docker network inspect supabase | grep portal-web`. Si falta, `docker compose up -d portal-web`.
- **Hairpin NAT** (portal-api no llega a `https://ecodatos.../wiki/sso/acceso`; en logs, timeouts/ECONNREFUSED hacia el dominio propio): descomentar `extra_hosts` con `host-gateway` en `portal-api` (apunta el nombre al host, donde escucha el Caddy/nginx), o `- supabase` en sus redes para llegar directo. `docker compose up -d portal-api`.
- **Cookie "Secure" sin HTTPS**: el portal exige `COOKIE_SECURE=true`; probar siempre por https. Por http el navegador descarta la cookie y el ingreso "no queda".
- **TRUST_PROXY=3** (valor por defecto): haproxy + nginx de ecodatos + portal-web = 3 saltos entre el cliente y portal-api. Debe contar exactamente los saltos: si es menor, todos los clientes comparten una IP (los límites de intentos bloquean a todos); si es mayor, se puede falsear la IP. Verificar con la IP que registran los logs de ingreso. Todos los proxies deben AGREGAR a `X-Forwarded-For` (`$proxy_add_x_forwarded_for`), no pisarlo. Si el haproxy no forma parte del camino, bajar a 2.
- **Pase rechazado ("vencido")**: reloj de la VM o de la Wiki desfasado (vida de 60 s). Activar NTP en ambas.
- **portal-api no arranca**: `docker compose logs portal-api`; la configuración falla cerrado (falta `ALTCHA_HMAC_KEY`, `SSO_ISSUER` no https, etc.).

## Rollback
```bash
git checkout <commit-anterior> && docker compose up -d --build     # vuelve el código; los datos (volumen portal_db) se conservan
```
Para sacar el portal de línea: quitar los `location` de `/portal` del nginx de ecodatos y recargar; `docker compose down` (sin `-v`: `-v` borra la base).
Rotar la clave: mover `secrets/sso-private.pem` a otro nombre, `generar-clave.sh`, `docker compose up -d portal-api`; los sistemas toman el JWKS nuevo.

## Compartir origen con /wiki, /pagos, /ide, /claves: riesgo
Bajo ecodatos, el portal comparte origen (esquema+host) con otras apps. Un XSS en cualquiera de ellas podría hacer `fetch('/portal/api/...')`
con la sesión del usuario (la cookie viaja a mismo origen). Mitigaciones: la cookie va con `Path=/portal` (no se envía a las otras rutas;
no la puede leer su JS por ser HttpOnly) y con un **nombre propio**, para no chocar con cookies de otras apps; CSP estricta y `frame-ancestors 'none'`.
Aun así, el aislamiento real solo lo da un origen propio: por eso conviene migrar al subdominio.

## Migrar al subdominio propio (cuando haya acceso al haproxy)
1. DNS de `portal.ecologia.misiones.gob.ar` hacia la VM y alta en haproxy/Caddy (TLS) apuntando al nginx de ecodatos, conservando `Host`.
2. En el nginx de ecodatos: reemplazar los `location` de `/portal` por el `server { server_name portal.ecologia.misiones.gob.ar; ... }` comentado al final de `ecodatos-nginx-portal.conf`; `nginx -t` y reload.
3. En `.env`: `PORTAL_BASE_PATH=/`, `VITE_BASE=/`, `SSO_ISSUER=https://portal.ecologia.misiones.gob.ar`, `PORTAL_URL=https://portal.ecologia.misiones.gob.ar`, y `FORM_ACTION_ORIGINS` si cambian los sistemas.
4. `docker compose up -d --build` (rebuild de `portal-web` por el nuevo `VITE_BASE`).
5. En la Wiki: actualizar `SSO_ISSUER`, `SSO_JWKS_URL` y `SSO_PORTAL_URL` a los valores nuevos y reiniciarla (el `iss` cambia: los pases viejos dejan de valer, son de 60 s).
6. Verificar `https://portal.ecologia.misiones.gob.ar/.well-known/jwks.json` y el ingreso completo.
