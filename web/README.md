# web/ — ingreso y botonera (Vite + React)

- `npm install --workspaces=false` (o desde la raíz), luego `npm test`.
- Desarrollo contra el server real: `npm run dev` (proxy `/api` -> `API_URL`, por defecto `http://127.0.0.1:3000`, el `PORT` por defecto de `server/`).
- Desarrollo contra el mock: `npm run mock` (:4000, clave `clave-prueba`; correos `nadie@`, `doble@`, `bloqueado@ecologia.test`) y `API_URL=http://127.0.0.1:4000 npm run dev`.
- Mock: `mock/handler.js` (función pura, refleja `server/src/app.js`; también la usan las pruebas).

## API del emisor (`server/src/app.js`, JSON, cookie HttpOnly, mismo origen `/api`)

| Método y ruta | Respuesta |
|---|---|
| `GET /api/config` | 200 `{registroUrl, recuperoUrl}` |
| `GET /api/altcha` | 200 desafío ALTCHA v1 `{algorithm, challenge, salt, signature, maxnumber}`. El widget (`altcha` 1.x) entrega el payload base64 que va en el campo `altcha`; es de un solo uso (la UI remonta el widget tras cada envío) |
| `POST /api/ingreso` `{email, clave, altcha, volver?}` | 200 `{ok, nombre, volver}` + cookie · 400 `captcha` (o `correo_vacio`) · 401 `credenciales` · 404 `correo_no_encontrado` · 409 `correo_duplicado` · 429 con `Retry-After` |
| `GET /api/sesion?volver=` | 200 `{empleado:{id,nombre,nombreCompleto,email}, volver}` (`volver` ya validado: id activo o null) · 401 |
| `POST /api/salir` | 200 `{ok:true}` |
| `GET /api/tarjetas[?forzar=1]` | 200 `{tarjetas:[{id,nombre,descripcion,icono,siempre_visible,rol,estado,pendiente}]}` inmediata |
| `GET /api/tarjetas/:id/estado[?forzar=1]` | 200 `{tarjeta}`; la UI lanza una por tarjeta pendiente y cada una aparece al responder |
| `POST /api/entrar/:id` | 200 `{url_login, token}` (use=login) · 403 · 404 |

Estados de tarjeta: `disponible`, `consultando` (oculta hasta responder), `sin_acceso` (se OCULTA), `no_disponible` (gris, no se abre). Las `siempre_visible` quedan disponibles aunque falle la consulta (sin rol). La caché de 10 min es del servidor (sesión); "Actualizar" pide `estado?forzar=1` por tarjeta.

`icono` llega como nombre (`users`, `book`, `fish`); la UI lo traduce a un glifo (también acepta URL/ruta o emoji).
`?volver=` se manda al servidor, que lo valida; la UI solo abre el `volver` que él devuelve y solo si la tarjeta está disponible. El enlace "sin acceso" de los sistemas debe apuntar al portal SIN `?volver` (evita bucles).

## Cabeceras para producción

El build estático lo sirve un servidor/proxy; debe poner estas cabeceras (no van por `<meta>`: `frame-ancestors` no funciona en meta y una CSP en meta rompe el dev server de Vite):

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self' https:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'` (ajustar `form-action` a los dominios de los sistemas; el widget ALTCHA puede requerir `worker-src 'self' blob:`).
- `X-Frame-Options: DENY`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Referrer-Policy: strict-origin` (el `<meta>` de `index.html` ya lo fija). **No usar `no-referrer`**: un POST cross-origin desde una página con esa política sale con `Origin: null` y los kits SSO lo rechazan (anti-CSRF), `X-Content-Type-Options: nosniff`.
