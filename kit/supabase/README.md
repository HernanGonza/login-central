# kit/supabase: Edge Function `sso`

Implementa `GET /functions/v1/sso/acceso` y `POST /functions/v1/sso/login` (CONTRATO.md secciones 2 y 3).

- `functions/sso/verificar.ts`: verificación en orden fijo (jose; JWKS remoto con caché 1 h).
- `functions/sso/handler.ts`: rutas, con dependencias inyectadas.
- `functions/sso/sesion_ecodatos.ts`: `auth.admin.generateLink` + `verifyOtp` en servidor (no envía correo); 302 a `SSO_INICIO_URL#access_token=...&refresh_token=...`.
- `functions/sso/sesion_alerta.ts`: PUNTO DE EXTENSION (pendiente cómo Alerta abre su sesión). Hoy falla cerrado (403).
- `sql/001_sso.sql`: schema `sso`, tabla `jti_usados`, funciones security definer solo para `service_role`.

## Variables

`SSO_JWKS_URL`, `SSO_ISSUER`, `SSO_AUD`, `SSO_SISTEMA` (`ecodatos`|`alerta`), `SSO_INICIO_URL`, `SSO_PORTAL_URL`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (solo ecodatos). Sin valores por defecto ni claves en el repo.
`SSO_JWKS_URL` debe ser `https://`; se rechaza `http://` salvo localhost/127.0.0.1/::1 o `SSO_PERMITIR_HTTP=1` (solo desarrollo).

Claims exigidos: `aud` string igual a `SSO_AUD` (un arreglo se rechaza); `iat` numerico y no futuro (tolerancia 60 s); `exp - iat` <= 60 s mas la tolerancia de 60 s (los vectores oficiales traen un pase de 80 s). Fallos de tiempo: motivo `exp`.

## SQL

Aplicar `sql/001_sso.sql` como `postgres`. Exponer el schema `sso` a PostgREST (`PGRST_DB_SCHEMAS=public,storage,graphql_public,sso`),
que solo `service_role` puede ejecutar (anon/authenticated no tienen USAGE). Alerta: completar `sso.alerta_config`
(tabla, col_id, col_email, col_activo, col_rol); ver el ejemplo comentado. Hasta entonces la función falla.

## Front de Ecodatos (recibir la sesión)

```js
const p = new URLSearchParams(location.hash.slice(1));
if (p.get('access_token')) {
  await supabase.auth.setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token') });
  history.replaceState(null, '', location.pathname + location.search);
}
```

## Despliegue: `--no-verify-jwt`

La función se despliega con `supabase functions deploy sso --no-verify-jwt` (`verify_jwt = false` en `supabase/config.toml`, sección `[functions.sso]`). Si no, el gateway de Supabase rechaza el pase (no es un JWT de Supabase) con 401 antes de llegar a la función. La función se protege sola verificando el pase RS256.

Errores internos: si falla el RPC de jti o el de usuario, `POST /sso/login` responde la página 403 y `GET /sso/acceso` responde 401 (nunca 500 JSON ni detalle).

## Exceptuar solo `sso` de VERIFY_JWT (self-hosted)

El pase no es un JWT de Supabase, así que el gateway lo rechazaría. En `volumes/functions/main/index.ts` (no tocar `JWT_SECRET`):
calcular el nombre del servicio antes del chequeo y saltearlo solo para `sso`.

```ts
const url = new URL(req.url)
const service_name = url.pathname.split('/')[1]          // /sso/acceso -> "sso"
const SIN_VERIFY_JWT = new Set(['sso'])                  // solo esta función

if (req.method !== 'OPTIONS' && VERIFY_JWT && !SIN_VERIFY_JWT.has(service_name)) {
  // ...chequeo de JWT existente, sin cambios
}
```

Los demás servicios siguen verificando. La función `sso` se protege sola verificando el pase RS256.
Nota: según la versión, mover `service_name` por encima del `if`, y revisar `volumes/api/kong.yml`: la ruta
`functions-v1` suele llevar `key-auth` (header `apikey`); el portal no lo envía, así que hace falta
una ruta Kong aparte para `/functions/v1/sso` sin key-auth (a verificar contra la instalación real).

## Pruebas

Con Deno local: `cd kit/supabase && deno test --allow-read --allow-env`
Sin Deno (Docker), desde la raíz del repo:

```
docker run --rm -v "$PWD":/w -w /w/kit/supabase -e VECTORES_DIR=/w/docs/sso/vectores \
  denoland/deno:latest test --allow-read --allow-env --no-lock tests/
```

Cubren los 14 vectores y las rutas (401 sin motivo, 403 sin acceso, no cacheable, jti de un solo uso). Las funciones SQL
y la sesión Ecodatos (generateLink/verifyOtp) NO tienen prueba automática: requieren un Supabase de desarrollo.

Defensa CSRF de `POST /sso/login`: el handler compara `Origin` con el origen de `SSO_PORTAL_URL` (opción `origenPortal` de `crearHandler` para sobrescribirlo). Con `Origin` debe coincidir (`Origin: null` se rechaza); sin `Origin` se rechaza `Sec-Fetch-Site: cross-site`; sin ninguna de las dos cabeceras se acepta. El POST autoenviado del portal envía `Origin: <origen del portal>`; para que el navegador no lo cambie a `null`, la página del portal que lo autoenvía no debe usar `Referrer-Policy: no-referrer` (usar `strict-origin`). Las respuestas llevan `X-Content-Type-Options: nosniff` y los pases de más de 8 KB se rechazan como `formato`.
