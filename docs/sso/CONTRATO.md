# Contrato SSO · Portal de ingreso único del Ministerio de Ecología

Fuente de verdad para todos los agentes. **No se modifica sin aprobación de Hernán.**
Si un agente cree que algo debe cambiar, lo reporta al orquestador.

## 0. Stack y estructura (decidido 2026-11-20)
- Portal: **Node (Express) + Vite/React**. (El plan original decía Next.js: reemplazado por decisión del usuario.)
- Base de Personal: **desconocida aún**. El portal accede a ella solo mediante el adaptador `server/src/personal/` (interfaz abajo). En desarrollo hay una implementación de PRUEBA (Postgres local). El día que se conozca el esquema real se cambia solo el adaptador.
- Base propia del portal: Postgres (`sso_sistemas`, `jti_usados`, intentos de ingreso).
- Todas las URLs e `iss` salen de variables de entorno (`SSO_ISSUER`, `PORTAL_URL`, …). Nunca en el código.

```
server/          Express: emisor, JWKS, sesión, botonera API      (agente emisor)
web/             Vite + React: ingreso y botonera                  (agente portal-ui)
kit/php/         verificación + rutas PHP                          (agente kit-php)
kit/node/        verificación + rutas Node                         (agente kit-node)
kit/supabase/    Edge Function sso + SQL                           (agente kit-supabase)
sistema-falso/   servicio de prueba con kit-node                   (agente sistema-falso)
docs/sso/        este contrato y vectores/
```

## 1. Pase (JWT)
- Firma **RS256** únicamente, header con `kid`. Clave privada fuera del repo (variable `SSO_PRIVATE_KEY_PATH` o `SSO_PRIVATE_KEY`).
- JWKS público: `GET /.well-known/jwks.json`.
- Claims: `iss`, `aud` (id del sistema), `sub` (id del empleado), `email` (minúsculas), `name`, `use` (`acceso`|`login`), `iat`, `exp` (= iat + 60 s), `jti` (único).
- Sin roles en el pase.

## 2. Verificación (orden fijo; el primer fallo corta)
1. Formato y `alg`: solo RS256 (rechaza `none`, HS256, etc.) → motivo `alg` / `formato`
2. Firma contra JWKS (caché 1 h; ante `kid` desconocido refrescar una vez) → `firma`
3. `iss` igual al configurado → `iss`
4. `aud` igual al id del sistema → `aud`
5. `exp` con tolerancia de 60 s → `exp`
6. `use` igual al esperado por la ruta → `use`
7. `jti` no usado antes (**solo** `use=login`; se marca como usado) → `jti`
8. Búsqueda por correo en minúsculas + usuario activo, con **la misma función** `buscarUsuarioPorCorreo(email)` en consulta e ingreso.

Los motivos se devuelven al código llamador, **nunca** al cliente HTTP (el cliente solo ve 401/403).

## 2b. Reglas adicionales de verificación (decididas 2026-11-20, tras los kits y la revisión de seguridad)
- `aud` debe ser un **string** igual al id del sistema (no se acepta arreglo).
- `iat` numérico y no futuro (tolerancia 60 s). Vida máxima `exp - iat` = **120 s** (60 s de vida + 60 s de tolerancia); un pase real del emisor dura 60 s. Estos fallos devuelven el motivo `exp`.
- Motivo interno `usuario` (paso 8): correo sin usuario, inactivo o **duplicado en la base del sistema** → en consulta `{"acceso":false}`, en ingreso 403. Nunca se informa el motivo al cliente.
- JWKS solo por **https**, salvo localhost/127.0.0.1/::1 o bandera explícita de desarrollo (`permitirHttp` / `SSO_PERMITIR_HTTP=1`). Falla de descarga del JWKS → motivo `firma`; refresco ante `kid` desconocido con enfriamiento (30 s en kit-node, 10 s en kit-php).
- jti: el almacén debe ser compartido entre procesos/servidores en producción (kit-node exige `jtiStore` explícito con `NODE_ENV=production`; kit-php exige `SSO_ESTADO_DIR` con modo 0700 y dueño correcto).
- Códigos: `/sso/acceso` pase inválido → 401; `/sso/login` cualquier fallo → 403 (nunca 401, nunca stack ni rutas), todas las respuestas `Cache-Control: no-store`. El enlace "sin acceso" apunta al portal **sin** `?volver` (evita bucles).

## 3. Rutas que implementa cada sistema
`GET /sso/acceso` (servidor a servidor), `Authorization: Bearer <pase use=acceso>`:
- 200 `{"acceso":true,"rol":"admin"}` (rol opcional) · 200 `{"acceso":false}` (pase válido, correo sin usuario/inactivo) · 401 pase inválido/vencido/ausente. Nunca responde sin pase válido.

`POST /sso/login`, `Content-Type: application/x-www-form-urlencoded`, `token=<pase use=login>`:
- 302 → inicio del sistema con sesión propia abierta · 403 → página "sin acceso" con enlace al portal. El pase nunca va en la URL. Las respuestas no deben cachearse.

Interfaz que cada sistema implementa: `buscarUsuarioPorCorreo(email) -> { id, rol?, activo } | null`
(PHP: `buscarUsuarioPorCorreo`). Y `abrirSesion(req, res, usuario)` en el login.

## 4. Portal
- Sesión: cookie HttpOnly, Secure, SameSite=Lax, 8 h (en desarrollo local sobre http, `Secure` configurable por variable pero **activo por defecto**).
- Ingreso: límite de intentos por correo **y** por IP; captcha **ALTCHA** auto-alojado (sin terceros). Sin 2FA por ahora. Enlaza al registro y recupero de clave de Personal (URLs por variable: `PERSONAL_REGISTRO_URL`, `PERSONAL_RECUPERO_URL`).
- Correo no encontrado o vacío → "No encontramos tu correo" + enlace a `PERSONAL_REGISTRO_URL`. Correo duplicado → no emitir pases; "Tu correo figura más de una vez. Contactate con el equipo de desarrollo: desarrollo@ecologia.misiones.gob.ar". Ambos con pruebas.
- Tabla `sso_sistemas` (base del portal): `id, nombre, descripcion, icono, url_login, url_acceso, siempre_visible, activo`. Semillas: `personal` y `wiki` (siempre_visible=true), `pesca` (consulta).
- Botonera: siempre_visible al instante; el resto en paralelo con `GET url_acceso` + Bearer (aud=id), timeout 3 s; tarjetas aparecen al responder; gris "no disponible" si falla/timeout; caché 10 min en la sesión; botón Actualizar. Muestra el rol si viene ("Wiki · administrador").
- Tocar tarjeta → POST autoenviado a `url_login` con `token` (use=login, aud=id). Nunca en URL.
- `?volver=<id>`: solo ids presentes en `sso_sistemas` (y activos); cualquier otro valor se ignora.
- Cerrar sesión del portal no cierra sesiones de los sistemas. El portal **no** deshabilita ni toca ningún login propio.
- `jti` emitidos para login se registran en el portal solo para auditoría; la verificación de un solo uso la hace cada sistema.

## 5. Adaptador de Personal (el portal nunca asume el esquema)
```ts
interface PersonalAdapter {
  // devuelve todos los empleados cuyo correo (minúsculas, trim) coincide; 0, 1 o más
  buscarPorCorreo(email: string): Promise<Empleado[]>;
  verificarClave(empleado: Empleado, clave: string): Promise<boolean>; // el hash vive en Personal
}
type Empleado = { id: string; email: string; nombre: string; apellido: string; activo: boolean };
```
Solo lectura. Implementación PRUEBA: Postgres local con tabla `empleados` (hash argon2id). Pendiente: algoritmo de hash real y columnas reales.

## 6. Estilo visual (actualizado 2026-11-20 con el BRANDBOOK 2024 del Ministerio, que reemplaza a Figtree y #2f6b4a)
Fuente de verdad: `BRANDBOOK 2024 - Ministerio de Ecología y RNR de Misiones.pdf` (raíz del repo).
- Tipografía: **Oak Sans** (Light/Regular/Bold). Fuentes en `dia-gis/public/fonts/` y `EcoAlerta/assets/fonts/` (proyectos hermanos): copiarlas a `web/`, sin CDN.
- Paleta digital (escala de verdes y beige): verde oscuro ~#213428, **verde institucional #3E6C51**, oliva ~#6F7F2A, verde claro ~#CBD6A4, amarillo ~#EFE36B, **beige de fondo #F5F3EF**. Flor del Lapacho: rosa #F5A5BF y magenta #C8346C (solo en el símbolo).
- Marca: flor del Lapacho + logotipo "ECOLOGÍA MISIONES" (versión símbolo+logotipo). **Respetar reglas de uso (p.14)**: sin cambiar colores, sin contornos, sin rotar ni deformar, sin fondos que resten legibilidad; área de seguridad alrededor; tamaño mínimo (p.13). Footer/acompañamiento con la marca "MISIONES" del Gobierno.
- Key visual (p.17): patrón de flores (gris/verde/rosado) para fondos; tres flores como acento. Tono institucional, no comercial.
- Ingreso: panel verde (#3E6C51) a la izquierda con el patrón de flores y "Todos los sistemas del Ministerio, con un solo ingreso."; a la derecha el formulario ("Ingresar", "Con tu cuenta del Ministerio.") sobre beige. Botonera: "Hola, [Nombre]", "Estos son tus sistemas" y grilla de tarjetas con ícono, nombre y descripción.

## 7. Vectores de prueba
`docs/sso/vectores/` (regenerables con `npm run vectores`): `jwks.PRUEBA.json`, `clave-privada.PRUEBA.pem`, `vectores.PRUEBA.json`. Reloj de pruebas fijo: `ahora` del JSON (inyectable en cada kit). Casos: valido_login, valido_acceso, vencido, dentro_tolerancia, iss_ajeno, aud_ajeno, firma_ajena, kid_desconocido, use_cambiado, alg_none, hs256, jti_repetido, email_mayusculas, basura.

## 8. Reglas de seguridad (el revisor las ataca)
Clave privada fuera del repo · solo RS256 · `/sso/acceso` nunca responde sin pase válido · pase de ingreso por POST y de un solo uso · `volver` solo a sistemas registrados · límite de intentos + captcha · nada de secretos/pases/claves en logs · todo por HTTPS en producción.

## 9. Límites del trabajo
Nada contra producción ni bases reales. No se toca Personal ni el login de ningún sistema. Sin commit/push sin pedido. Sin PHP local: `kit-php` se prueba en Docker (`php:8.3-cli`).
