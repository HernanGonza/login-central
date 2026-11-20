import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { SignJWT, importPKCS8 } from 'jose';
import { crearVerificador, crearRutasSSO, crearAlmacenJtiMemoria } from '../src/index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/sso/vectores');
const V = JSON.parse(readFileSync(path.join(dir, 'vectores.PRUEBA.json'), 'utf8'));
const JWKS = readFileSync(path.join(dir, V.jwks), 'utf8');

let jwksServer, jwksUrl, jwksHits = 0;
before(async () => {
  jwksServer = http.createServer((req, res) => {
    jwksHits++;
    res.setHeader('content-type', 'application/json');
    res.end(JWKS);
  });
  await new Promise((r) => jwksServer.listen(0, '127.0.0.1', r));
  jwksUrl = `http://127.0.0.1:${jwksServer.address().port}/.well-known/jwks.json`;
});
after(() => jwksServer.close());

const usuarios = { 'ana.perez@ecologia.test': { id: 'u1', rol: 'admin', activo: true } };
const buscarUsuarioPorCorreo = async (email) => usuarios[email] ?? null;
const ahora = () => V.ahora;

const nuevo = (extra = {}) => crearVerificador({
  issuer: V.iss, audience: V.aud_esperada, jwksUrl, ahora, buscarUsuarioPorCorreo, cooldownJwks: 0, permitirMemoria: true, ...extra,
});

for (const [nombre, caso] of Object.entries(V.casos)) {
  if (nombre === 'jti_repetido') continue;
  test(`vector ${nombre}`, async () => {
    const verificar = nuevo();
    const r = await verificar(caso.token, { use: caso.use_esperado });
    if (caso.esperado === 'ok') {
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.claims.email, r.claims.email.toLowerCase());
      assert.equal(r.usuario.id, 'u1');
    } else {
      assert.deepEqual(r, { ok: false, motivo: caso.esperado });
    }
  });
}

test('vector jti_repetido: 1a ok, 2a jti', async () => {
  const verificar = nuevo();
  const c = V.casos.jti_repetido;
  assert.equal((await verificar(c.token, { use: 'login' })).ok, true);
  assert.deepEqual(await verificar(c.token, { use: 'login' }), { ok: false, motivo: 'jti' });
});

test('use=acceso no consume jti: se puede repetir', async () => {
  const verificar = nuevo();
  const c = V.casos.valido_acceso;
  assert.equal((await verificar(c.token, { use: 'acceso' })).ok, true);
  assert.equal((await verificar(c.token, { use: 'acceso' })).ok, true);
});

test('jti concurrente: solo uno gana', async () => {
  const verificar = nuevo();
  const t = V.casos.valido_login.token;
  const rs = await Promise.all([1, 2, 3, 4].map(() => verificar(t, { use: 'login' })));
  assert.equal(rs.filter((r) => r.ok).length, 1);
});

test('el jti no se marca si falla un paso anterior (use cambiado)', async () => {
  const store = crearAlmacenJtiMemoria();
  const verificar = nuevo({ jtiStore: store });
  await verificar(V.casos.use_cambiado.token, { use: 'login' });
  assert.equal(store.tamano, 0);
});

test('kid desconocido provoca refresco del JWKS y luego falla', async () => {
  const verificar = nuevo();
  await verificar(V.casos.valido_acceso.token, { use: 'acceso' }); // carga caché
  const antes = jwksHits;
  const r = await verificar(V.casos.kid_desconocido.token, { use: 'login' });
  assert.equal(r.motivo, 'firma');
  assert.equal(jwksHits, antes + 1);
});

test('JWKS en caché: no se vuelve a pedir en pases normales', async () => {
  const verificar = nuevo();
  await verificar(V.casos.valido_acceso.token, { use: 'acceso' });
  const antes = jwksHits;
  await verificar(V.casos.valido_acceso.token, { use: 'acceso' });
  assert.equal(jwksHits, antes);
});

test('usuario inexistente o inactivo -> motivo usuario', async () => {
  const v1 = nuevo({ buscarUsuarioPorCorreo: async () => null });
  assert.deepEqual(await v1(V.casos.valido_acceso.token, { use: 'acceso' }), { ok: false, motivo: 'usuario' });
  const v2 = nuevo({ buscarUsuarioPorCorreo: async () => ({ id: 'x', activo: false }) });
  assert.equal((await v2(V.casos.valido_acceso.token, { use: 'acceso' })).motivo, 'usuario');
});

test('email en mayúsculas llega en minúsculas a buscarUsuarioPorCorreo', async () => {
  const vistos = [];
  const v = nuevo({ buscarUsuarioPorCorreo: async (e) => { vistos.push(e); return { id: 'u', activo: true }; } });
  await v(V.casos.email_mayusculas.token, { use: 'login' });
  assert.deepEqual(vistos, ['ana.perez@ecologia.test']);
});

test('entradas raras no lanzan excepciones', async () => {
  const v = nuevo();
  for (const t of [undefined, null, 42, '', '..', 'a.b.c', 'x'.repeat(10000)]) {
    assert.equal((await v(t, { use: 'login' })).ok, false);
  }
  assert.equal((await v(V.casos.valido_login.token)).motivo, 'use'); // sin use
});

// ---------- rutas ----------
async function levantar({ buscar = buscarUsuarioPorCorreo, fallos = [] } = {}) {
  const app = express();
  const sesiones = [];
  const verificar = nuevo({ buscarUsuarioPorCorreo: buscar });
  app.use(crearRutasSSO({
    verificar,
    abrirSesion: (req, res, usuario) => { sesiones.push(usuario.id); res.cookie('sid', 'abc', { httpOnly: true }); },
    inicioUrl: '/inicio',
    portalUrl: 'https://portal.prueba.invalid/?a=1&b="2"',
    alFallar: (i) => fallos.push(i),
  }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { base: `http://127.0.0.1:${srv.address().port}`, srv, sesiones, fallos };
}
const form = (token) => ({
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ token }).toString(),
});

test('GET /sso/acceso: 200 con rol', async () => {
  const s = await levantar();
  try {
    const r = await fetch(`${s.base}/sso/acceso`, { headers: { authorization: `Bearer ${V.casos.valido_acceso.token}` } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { acceso: true, rol: 'admin' });
    assert.match(r.headers.get('cache-control'), /no-store/);
  } finally { s.srv.close(); }
});

test('GET /sso/acceso: pase válido sin usuario -> acceso:false', async () => {
  const s = await levantar({ buscar: async () => null });
  try {
    const r = await fetch(`${s.base}/sso/acceso`, { headers: { authorization: `Bearer ${V.casos.valido_acceso.token}` } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { acceso: false });
  } finally { s.srv.close(); }
});

test('GET /sso/acceso: sin pase, basura, vencido, pase de login -> 401 sin motivo al cliente', async () => {
  const fallos = [];
  const s = await levantar({ fallos });
  try {
    const intentos = [{}, { authorization: 'Bearer basura' }, { authorization: `Bearer ${V.casos.vencido.token}` },
      { authorization: `Bearer ${V.casos.valido_login.token}` }, { authorization: `Basic ${V.casos.valido_acceso.token}` }];
    for (const headers of intentos) {
      const r = await fetch(`${s.base}/sso/acceso`, { headers });
      assert.equal(r.status, 401);
      assert.equal(await r.text(), '');
    }
    assert.deepEqual(fallos.map((f) => f.motivo), ['formato', 'formato', 'exp', 'use', 'formato']);
    assert.ok(!JSON.stringify(fallos).includes('eyJ'));
  } finally { s.srv.close(); }
});

test('POST /sso/login: 302, sesión abierta, sin cache, token no en URL', async () => {
  const s = await levantar();
  try {
    const r = await fetch(`${s.base}/sso/login`, form(V.casos.valido_login.token));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/inicio');
    assert.match(r.headers.get('set-cookie'), /sid=abc/);
    assert.match(r.headers.get('cache-control'), /no-store/);
    assert.deepEqual(s.sesiones, ['u1']);
  } finally { s.srv.close(); }
});

test('POST /sso/login: reutilizar el pase -> 403 y no abre sesión', async () => {
  const s = await levantar();
  try {
    await fetch(`${s.base}/sso/login`, form(V.casos.valido_login.token));
    const r = await fetch(`${s.base}/sso/login`, form(V.casos.valido_login.token));
    assert.equal(r.status, 403);
    assert.equal(s.sesiones.length, 1);
    assert.deepEqual(s.fallos, [{ ruta: 'login', motivo: 'jti' }]);
  } finally { s.srv.close(); }
});

test('POST /sso/login: 403 con enlace escapado al portal; sin motivo en el cuerpo', async () => {
  const s = await levantar();
  try {
    for (const t of [V.casos.firma_ajena.token, V.casos.alg_none.token, V.casos.aud_ajeno.token, '']) {
      const r = await fetch(`${s.base}/sso/login`, form(t));
      assert.equal(r.status, 403);
      assert.equal(r.headers.get('set-cookie'), null);
      const html = await r.text();
      assert.ok(html.includes('href="https://portal.prueba.invalid/?a=1&amp;b=&quot;2&quot;"'));
      assert.ok(!/firma|alg|aud/i.test(html.replace(/<style>.*<\/style>/s, '')));
    }
    assert.equal(s.sesiones.length, 0);
  } finally { s.srv.close(); }
});

test('POST /sso/login: usuario inexistente -> 403; token por query (GET) no existe', async () => {
  const s = await levantar({ buscar: async () => null });
  try {
    const r = await fetch(`${s.base}/sso/login`, form(V.casos.valido_login.token));
    assert.equal(r.status, 403);
    const g = await fetch(`${s.base}/sso/login?token=${V.casos.email_mayusculas.token}`, { redirect: 'manual' });
    assert.equal(g.status, 404);
    assert.equal(s.sesiones.length, 0);
  } finally { s.srv.close(); }
});

test('POST /sso/login: si abrirSesion falla -> 403', async () => {
  const app = express();
  app.use(crearRutasSSO({
    verificar: nuevo(), abrirSesion: () => { throw new Error('boom'); }, portalUrl: 'https://p.invalid/',
  }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/sso/login`, form(V.casos.valido_login.token));
    assert.equal(r.status, 403);
  } finally { srv.close(); }
});

// ---------- endurecimiento (revisión de seguridad) ----------
const clavePriv = await importPKCS8(readFileSync(path.join(dir, 'clave-privada.PRUEBA.pem'), 'utf8'), 'RS256');
async function firmarPropio({ iat = V.ahora - 5, exp = iat + 60, aud = V.aud_esperada, jti = `jti-h-${Math.random()}`, quitarIat = false, extra = {} } = {}) {
  const j = new SignJWT({ email: 'ana.perez@ecologia.test', sub: 'emp-1001', use: 'login', ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'PRUEBA-1' }).setIssuer(V.iss).setAudience(aud).setExpirationTime(exp).setJti(jti);
  if (!quitarIat) j.setIssuedAt(iat);
  return j.sign(clavePriv);
}

test('sanidad: el firmador propio produce un pase válido', async () => {
  assert.equal((await nuevo()(await firmarPropio(), { use: 'login' })).ok, true);
});

test('aud como arreglo (aunque incluya el id) -> aud', async () => {
  const t = await firmarPropio({ aud: [V.aud_esperada] });
  assert.deepEqual(await nuevo()(t, { use: 'login' }), { ok: false, motivo: 'aud' });
});

test('iat ausente -> rechazado', async () => {
  const t = await firmarPropio({ quitarIat: true, exp: V.ahora + 30 });
  assert.equal((await nuevo()(t, { use: 'login' })).ok, false);
});

test('iat no numérico -> rechazado', async () => {
  const t = await firmarPropio({ extra: { iat: '1790000000' }, quitarIat: true, exp: V.ahora + 30 });
  assert.equal((await nuevo()(t, { use: 'login' })).ok, false);
});

test('iat en el futuro (más allá de 60 s) -> rechazado; dentro de 60 s ok', async () => {
  const lejos = await firmarPropio({ iat: V.ahora + 61 });
  assert.equal((await nuevo()(lejos, { use: 'login' })).ok, false);
  const cerca = await firmarPropio({ iat: V.ahora + 50 });
  assert.equal((await nuevo()(cerca, { use: 'login' })).ok, true);
});

test('exp - iat > vida máxima -> rechazado; 60 s exactos ok', async () => {
  const largo = await firmarPropio({ iat: V.ahora - 5, exp: V.ahora - 5 + 3600 });
  assert.equal((await nuevo()(largo, { use: 'login' })).ok, false);
  const justo = await firmarPropio({ iat: V.ahora - 5, exp: V.ahora - 5 + 60 });
  assert.equal((await nuevo()(justo, { use: 'login' })).ok, true);
});

test('jwksUrl http:// remota se rechaza; https, localhost y permitirHttp pasan', () => {
  const mk = (u, extra = {}) => crearVerificador({ issuer: 'i', audience: 'a', jwksUrl: u, permitirMemoria: true, ...extra });
  assert.throws(() => mk('http://portal.ejemplo.invalid/jwks.json'), /https/);
  assert.throws(() => mk('ftp://x.invalid/j'), /https/);
  assert.throws(() => mk('no es url'), /jwksUrl/);
  mk('https://portal.ejemplo.invalid/jwks.json');
  mk('http://localhost:3000/jwks.json');
  mk('http://127.0.0.1:3000/jwks.json');
  mk('http://[::1]:3000/jwks.json');
  mk('http://portal.ejemplo.invalid/jwks.json', { permitirHttp: true });
});

test('NODE_ENV=production sin jtiStore explícito -> falla; con jtiStore ok', () => {
  const previo = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => nuevo({ permitirMemoria: false }), /jtiStore/);
    nuevo({ jtiStore: crearAlmacenJtiMemoria() });
  } finally {
    if (previo === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previo;
  }
});

test('POST /sso/login > 16 KB -> 403 página sin acceso, sin stack ni rutas', async () => {
  const fallos = [];
  const s = await levantar({ fallos });
  try {
    const r = await fetch(`${s.base}/sso/login`, form('a'.repeat(20000)));
    assert.equal(r.status, 403);
    assert.match(r.headers.get('content-type'), /html/);
    assert.match(r.headers.get('cache-control'), /no-store/);
    const html = await r.text();
    assert.ok(html.includes('Sin acceso'));
    assert.ok(!/node_modules|\sat |Error|\.js:\d+|PayloadTooLarge/.test(html));
    assert.equal(s.sesiones.length, 0);
    assert.deepEqual(fallos, [{ ruta: 'login', motivo: 'error' }]);
  } finally { s.srv.close(); }
});

// ---------- CSRF de login (origenPortal) ----------
async function levantarOrigen(origenPortal) {
  const app = express();
  const sesiones = [];
  app.use(crearRutasSSO({
    verificar: nuevo(), abrirSesion: (req, res, u) => { sesiones.push(u.id); },
    portalUrl: 'http://localhost:5173/', origenPortal,
  }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { base: `http://127.0.0.1:${srv.address().port}`, srv, sesiones };
}
const conCab = (token, cab) => { const f = form(token); f.headers = { ...f.headers, ...cab }; return f; };

test('CSRF login: el POST autoenviado del portal (Origin del portal, cross-site) funciona', async () => {
  const s = await levantarOrigen('http://localhost:5173');
  try {
    const r = await fetch(`${s.base}/sso/login`, conCab(V.casos.valido_login.token, { origin: 'http://localhost:5173', 'sec-fetch-site': 'cross-site' }));
    assert.equal(r.status, 302);
    assert.equal(s.sesiones.length, 1);
  } finally { s.srv.close(); }
});

test('CSRF login: Origin ajeno u "null" -> 403 sin sesión (aunque el pase sea válido)', async () => {
  const s = await levantarOrigen('http://localhost:5173');
  try {
    for (const origin of ['https://atacante.invalid', 'null', 'http://localhost:5173.atacante.invalid', 'http://localhost:5174']) {
      const r = await fetch(`${s.base}/sso/login`, conCab(V.casos.valido_login.token, { origin }));
      assert.equal(r.status, 403, origin);
    }
    assert.equal(s.sesiones.length, 0);
  } finally { s.srv.close(); }
});

test('CSRF login: sin Origin, Sec-Fetch-Site cross-site -> 403; same-origin/none/ausente -> pasa', async () => {
  const s = await levantarOrigen('http://localhost:5173');
  try {
    const cross = await fetch(`${s.base}/sso/login`, conCab(V.casos.valido_login.token, { 'sec-fetch-site': 'cross-site' }));
    assert.equal(cross.status, 403);
    assert.equal(s.sesiones.length, 0);
    const sin = await fetch(`${s.base}/sso/login`, form(V.casos.valido_login.token)); // cliente sin cabeceras
    assert.equal(sin.status, 302);
  } finally { s.srv.close(); }
});

test('CSRF login: sin origenPortal se deriva de portalUrl', async () => {
  const s = await levantarOrigen(undefined);
  try {
    const mal = await fetch(`${s.base}/sso/login`, conCab(V.casos.valido_login.token, { origin: 'https://atacante.invalid' }));
    assert.equal(mal.status, 403);
    const bien = await fetch(`${s.base}/sso/login`, conCab(V.casos.valido_login.token, { origin: 'http://localhost:5173' }));
    assert.equal(bien.status, 302);
  } finally { s.srv.close(); }
});

test('buscarUsuarioPorCorreo recibe { use } (alta solo en login)', async () => {
  const usos = [];
  const v = nuevo({ buscarUsuarioPorCorreo: async (e, o) => { usos.push(o.use); return usuarios[e]; } });
  await v(V.casos.valido_acceso.token, { use: 'acceso' });
  await v(V.casos.valido_login.token, { use: 'login' });
  assert.deepEqual(usos, ['acceso', 'login']);
});

test('buscarUsuarioPorCorreo recibe { use, name } con el claim name', async () => {
  const vistos = [];
  const v = nuevo({ buscarUsuarioPorCorreo: async (e, o) => { vistos.push(o); return { id: 'u', activo: true }; } });
  await v(await firmarPropio({ extra: { name: 'Ana Pérez' } }), { use: 'login' });
  await v(await firmarPropio(), { use: 'login' });
  await v(await firmarPropio({ extra: { name: 42 } }), { use: 'login' });
  assert.deepEqual(vistos, [{ use: 'login', name: 'Ana Pérez' }, { use: 'login', name: undefined }, { use: 'login', name: undefined }]);
});

test('guarda de jtiStore: falla cerrado salvo development o permitirMemoria', () => {
  const previo = process.env.NODE_ENV;
  const base = { issuer: V.iss, audience: V.aud_esperada, jwksUrl };
  try {
    for (const env of [undefined, 'production', 'prod', 'staging', 'test']) {
      if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
      assert.throws(() => crearVerificador(base), /jtiStore/, `NODE_ENV=${env}`);
      assert.doesNotThrow(() => crearVerificador({ ...base, permitirMemoria: true }));
      assert.doesNotThrow(() => crearVerificador({ ...base, jtiStore: crearAlmacenJtiMemoria() }));
    }
    process.env.NODE_ENV = 'development';
    assert.doesNotThrow(() => crearVerificador(base));
  } finally {
    if (previo === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previo;
  }
});

test('ejemplo wiki: 5 logins concurrentes del mismo correo nuevo crean una sola fila', async () => {
  const { crearBuscarUsuarioPorCorreo } = await import('../ejemplos/wiki-usuarios.js');
  const filas = [];
  const tick = () => new Promise((r) => setImmediate(r));
  // db falsa estilo pg que emula UNIQUE(lower(email)) + ON CONFLICT DO NOTHING
  const db = { async query(sql, [email]) {
    await tick();
    if (/^SELECT/.test(sql)) return { rows: filas.filter((f) => f.email.toLowerCase() === email) };
    if (/ON CONFLICT \(lower\(email\)\) DO NOTHING/.test(sql)) {
      if (!filas.some((f) => f.email.toLowerCase() === email)) filas.push({ id: filas.length + 1, email, rol: 'lector', activo: true });
      return { rows: [] };
    }
    throw new Error('sql inesperado');
  } };
  const buscar = crearBuscarUsuarioPorCorreo(db);
  const rs = await Promise.all(Array.from({ length: 5 }, () => buscar('nuevo@ecologia.test', { use: 'login' })));
  assert.equal(filas.length, 1);
  assert.ok(rs.every((r) => r && r.id === '1' && r.rol === 'lector' && r.activo === true));
  assert.equal(await buscar('otro@ecologia.test', { use: 'acceso' }), null);
  assert.equal(filas.length, 1);
  filas[0].activo = false; // revocar = activo=false
  assert.equal((await buscar('nuevo@ecologia.test', { use: 'login' })).activo, false);
  assert.equal(filas.length, 1);
});
