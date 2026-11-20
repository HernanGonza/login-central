# @ecologia/sso-kit-node

Kit SSO para sistemas Node/Express (contrato: `docs/sso/CONTRATO.md`). ESM, Node >= 20, dependencia `jose`; `express` es peer.

## Uso

```js
import { crearVerificador, crearRutasSSO } from '@ecologia/sso-kit-node';

const verificar = crearVerificador({
  issuer: process.env.SSO_ISSUER,
  audience: process.env.SSO_AUDIENCE,   // id de este sistema
  jwksUrl: process.env.SSO_JWKS_URL,
  buscarUsuarioPorCorreo,               // (email en minúsculas, { use, name }) -> { id, rol?, activo } | null
  // jtiStore, ahora (reloj), cooldownJwks
});
app.use(crearRutasSSO({ verificar, abrirSesion, inicioUrl: '/', portalUrl: process.env.PORTAL_URL }));
```

- `verificar(token, { use })` -> `{ ok:true, claims, usuario }` o `{ ok:false, motivo }`. Motivos: `formato | alg | firma | iss | aud | exp | use | jti | usuario`. Orden fijo del contrato; el primer fallo corta. Los motivos van solo al código llamador (`alFallar`), nunca al cliente.
- JWKS: `createRemoteJWKSet`, caché 1 h, un refresco ante `kid` desconocido (con espera mínima `cooldownJwks`, 30 s por defecto, contra abuso). Solo RS256.
- `GET /sso/acceso`: 200 `{acceso:true,rol?}`, 200 `{acceso:false}` (pase válido, usuario ausente/inactivo), 401 en cualquier otro caso. Sin `use=acceso` válido nunca responde datos.
- `POST /sso/login` (form `token=`): 302 a `inicioUrl` tras `abrirSesion(req, res, usuario, claims)`; 403 con página "sin acceso" y enlace al portal. Respuestas `no-store`. Token por GET no existe (404).
- Si `abrirSesion` lanza, se responde 403.

## Endurecimiento
- `jwksUrl` debe ser `https://`. Se acepta `http://` solo para `localhost`, `127.0.0.1` y `::1`, o con `permitirHttp: true` (únicamente desarrollo). Si no, `crearVerificador` lanza.
- Hay que pasar `jtiStore` explícito (compartido entre procesos/instancias) salvo con `NODE_ENV=development` o la opción explícita `permitirMemoria: true`; si no, `crearVerificador` lanza (la guarda falla cerrado: un `NODE_ENV` sin definir o mal escrito no habilita memoria). El almacén de memoria es por proceso: un pase de login se podría reutilizar en otra instancia o tras un reinicio.
- Claims: `aud` debe ser un string igual al id del sistema (un arreglo se rechaza); `iat` numérico y no futuro (tolerancia 60 s); `exp - iat` no mayor a 60 s más la tolerancia de 60 s (los vectores oficiales incluyen un pase con vida de 80 s). Los fallos de tiempo dan motivo `exp`.
- Cualquier error del router (p. ej. cuerpo de más de 16 KB en `/sso/login`) responde la página "sin acceso" con 403 (401 en `/sso/acceso`), sin stack ni rutas.

## jti de un solo uso
Solo `use=login`. El almacén es un objeto con `marcarUsado(jti, expira, ahora) -> Promise<boolean>` atómico (true = primera vez). Memoria (`crearAlmacenJtiMemoria`) solo en desarrollo o con `permitirMemoria: true`; en producción es obligatorio pasar uno explícito; con varias instancias usar uno compartido. Ejemplo Postgres (`INSERT ... ON CONFLICT DO NOTHING`, `rowCount === 1`) en `src/jti-store.js`.

## Ejemplo Wiki
`ejemplos/wiki.js`: `buscarUsuarioPorCorreo(email, { use, name })` es la misma búsqueda en consulta e ingreso, pero crea el usuario lector (si el correo no existe) **solo cuando `use === 'login'`**. El kit pasa `{ use, name }` como segundo argumento: `name` es el claim `name` del pase (string, o `undefined` si falta o no es string); sirve para dar nombre al usuario recién creado. Compatible hacia atrás: quien solo lee `use` sigue funcionando. Así la botonera (`/sso/acceso`, `use='acceso'`) nunca provisiona usuarios: un correo sin usuario responde `{"acceso":false}`; el alta ocurre únicamente en `POST /sso/login`, después de verificar firma, `jti` de un solo uso, etc.

**Alta atómica.** El alta no puede ser "buscar y, si no existe, insertar" sin más: 5 logins concurrentes de un correo nuevo crearían 5 filas. El ejemplo (`ejemplos/wiki-usuarios.js`) usa `CREATE UNIQUE INDEX ... ON usuarios (lower(email))`, `INSERT ... ON CONFLICT (lower(email)) DO NOTHING` y vuelve a consultar. **Para revocar el acceso hay que poner `activo=false`, no borrar la fila**: si se borra, el próximo login válido la recrea como lector activo.

## Pruebas
```
cd kit/node && npm install && npm test
```
Usan `docs/sso/vectores/` (14 casos), un servidor JWKS local efímero y reloj fijo (`ahora` del JSON). Sin red externa ni claves reales.

## Defensa CSRF de `POST /sso/login` (`origenPortal`)
`crearRutasSSO({ ..., origenPortal })` (def.: el origen de `portalUrl`). Regla: si el request trae `Origin`, debe ser exactamente el origen del portal; si no trae `Origin`, se rechaza `Sec-Fetch-Site: cross-site`; si no hay ninguna de las dos cabeceras (curl, clientes de servidor) se acepta. Fallo -> 403 igual que cualquier otro.

Un formulario autoenviado desde el portal hacia el sistema es una petición cross-origin y el navegador envía `Origin: <origen del portal>` (y `Sec-Fetch-Site: cross-site`), por lo que pasa. **`Origin: null` se rechaza**: lo envían contextos sandbox/`data:`, redirecciones cross-origin y, importante, los formularios POST de páginas con `Referrer-Policy: no-referrer` (la especificación de Fetch serializa el origen como `null`). Por eso la página del portal que autoenvía el formulario debe usar una política que conserve el origen (p. ej. `strict-origin` u `origin`), no `no-referrer`.
