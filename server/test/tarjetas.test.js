import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { crearEntorno, ISSUER } from './helpers.js';

// Sistemas falsos: se responde según la URL; se registra cada llamada.
const llamadas = [];
let comportamiento = {};
let reloj = Date.now();
async function fetchFalso(url, opts) {
  const host = new URL(url).hostname;
  llamadas.push({ host, auth: opts.headers.Authorization });
  const c = comportamiento[host] ?? { acceso: false };
  if (c.cuelga) {
    return new Promise((_, rechazar) => opts.signal.addEventListener('abort', () => rechazar(opts.signal.reason)));
  }
  if (c.status) return new Response('x', { status: c.status });
  return Response.json(c);
}

let t;
before(async () => {
  t = await crearEntorno({ fetchImpl: fetchFalso, ahoraMs: () => reloj, env: { TARJETAS_TIMEOUT_MS: '300' } });
});
after(async () => { await t.cerrar(); });

const por = (r, id) => r.json.tarjetas.find((x) => x.id === id);

test('semillas: personal y wiki siempre visibles, pesca de consulta; sin urls en la respuesta', async () => {
  const { rows } = await t.pool.query('SELECT id, siempre_visible FROM sso_sistemas ORDER BY id');
  assert.deepEqual(rows, [
    { id: 'personal', siempre_visible: true }, { id: 'pesca', siempre_visible: false }, { id: 'wiki', siempre_visible: true },
  ]);
  const cookie = await t.sesion();
  const r = await t.get('/api/tarjetas', cookie);
  assert.equal(JSON.stringify(r.json).includes('invalid'), false);
});

test('GET /api/tarjetas responde de inmediato sin consultar a los sistemas', async () => {
  llamadas.length = 0;
  comportamiento = { 'pesca.invalid': { cuelga: true } };
  const cookie = await t.sesion();
  const ini = Date.now();
  const r = await t.get('/api/tarjetas', cookie);
  assert.ok(Date.now() - ini < 250);
  assert.equal(llamadas.length, 0);
  assert.equal(por(r, 'personal').estado, 'disponible');
  assert.equal(por(r, 'wiki').estado, 'disponible');
  assert.equal(por(r, 'pesca').estado, 'consultando');
});

test('consulta en paralelo con Bearer use=acceso, aud=id verificable con JWKS, rol visible', async () => {
  llamadas.length = 0;
  comportamiento = {
    'wiki.invalid': { acceso: true, rol: 'admin' },
    'pesca.invalid': { acceso: true },
    'personal.invalid': { acceso: false },
  };
  const cookie = await t.sesion();
  const r = await t.get('/api/tarjetas/estado', cookie);
  assert.equal(llamadas.length, 3);
  const jwks = createLocalJWKSet((await t.get('/.well-known/jwks.json')).json);
  for (const l of llamadas) {
    const aud = l.host.split('.')[0];
    const { payload } = await jwtVerify(l.auth.replace('Bearer ', ''), jwks, { issuer: ISSUER, audience: aud });
    assert.equal(payload.use, 'acceso');
  }
  assert.equal(por(r, 'wiki').rol, 'admin');
  assert.equal(por(r, 'pesca').estado, 'disponible');
  assert.equal(por(r, 'personal').estado, 'disponible'); // siempre visible aunque acceso=false
});

test('pesca: acceso=false -> sin_acceso; fallo HTTP o timeout -> no_disponible (siempre_visible sigue visible)', async () => {
  const cookie = await t.sesion();
  comportamiento = { 'pesca.invalid': { acceso: false }, 'wiki.invalid': { status: 500 }, 'personal.invalid': { cuelga: true } };
  const ini = Date.now();
  let r = await t.get('/api/tarjetas/estado?forzar=1', cookie);
  assert.ok(Date.now() - ini < 1500, 'el timeout corta la espera');
  assert.equal(por(r, 'pesca').estado, 'sin_acceso');
  assert.equal(por(r, 'wiki').estado, 'disponible');
  assert.equal(por(r, 'personal').estado, 'disponible');
  comportamiento = { 'pesca.invalid': { cuelga: true } };
  r = await t.get('/api/tarjetas/pesca/estado?forzar=1', cookie);
  assert.equal(r.json.tarjeta.estado, 'no_disponible');
  comportamiento = { 'pesca.invalid': { status: 200, acceso: 'si' } };
  r = await t.get('/api/tarjetas/pesca/estado?forzar=1', cookie);
  assert.equal(r.json.tarjeta.estado, 'no_disponible');
});

test('caché de 10 min en la sesión y forzar actualización', async () => {
  const cookie = await t.sesion();
  comportamiento = { 'pesca.invalid': { acceso: true, rol: 'editor' } };
  llamadas.length = 0;
  let r = await t.get('/api/tarjetas/pesca/estado', cookie);
  assert.equal(r.json.tarjeta.rol, 'editor');
  assert.equal(llamadas.length, 1);
  r = await t.get('/api/tarjetas/pesca/estado', cookie);
  assert.equal(llamadas.length, 1, 'segunda vez sale del caché');
  assert.equal(por(await t.get('/api/tarjetas', cookie), 'pesca').rol, 'editor');
  comportamiento = { 'pesca.invalid': { acceso: true, rol: 'admin' } };
  r = await t.get('/api/tarjetas/pesca/estado?forzar=1', cookie);
  assert.equal(llamadas.length, 2);
  assert.equal(r.json.tarjeta.rol, 'admin');
  reloj += 9 * 60 * 1000;
  await t.get('/api/tarjetas/pesca/estado', cookie);
  assert.equal(llamadas.length, 2, 'a los 9 min sigue en caché');
  reloj += 2 * 60 * 1000;
  await t.get('/api/tarjetas/pesca/estado', cookie);
  assert.equal(llamadas.length, 3, 'a los 11 min se vuelve a consultar');
  const lista = await t.get('/api/tarjetas?forzar=1', cookie);
  assert.equal(por(lista, 'pesca').estado, 'consultando', 'forzar vacía el caché');
});

test('el caché es por sesión', async () => {
  comportamiento = { 'pesca.invalid': { acceso: true } };
  const a = await t.sesion('ana.perez@ecologia.test');
  const b = await t.sesion('luis.gomez@ecologia.test');
  await t.get('/api/tarjetas/pesca/estado?forzar=1', a);
  assert.equal(por(await t.get('/api/tarjetas', b), 'pesca').estado, 'consultando');
});

test('POST /api/entrar/:id devuelve pase login (aud=id, un jti nuevo cada vez) y exige sesión', async () => {
  assert.equal((await t.post('/api/entrar/wiki', {})).status, 401);
  const cookie = await t.sesion();
  const r = await t.post('/api/entrar/wiki', {}, cookie);
  assert.equal(r.status, 200);
  assert.equal(r.json.url_login, 'http://wiki.invalid/sso/login');
  const jwks = createLocalJWKSet((await t.get('/.well-known/jwks.json')).json);
  const { payload } = await jwtVerify(r.json.token, jwks, { issuer: ISSUER, audience: 'wiki' });
  assert.equal(payload.use, 'login');
  assert.equal(payload.sub, 'emp-1001');
  const r2 = await t.post('/api/entrar/wiki', {}, cookie);
  assert.notEqual(
    JSON.parse(Buffer.from(r2.json.token.split('.')[1], 'base64url')).jti, payload.jti);
  assert.equal((await t.post('/api/entrar/no-existe', {}, cookie)).status, 404);
  await t.pool.query("UPDATE sso_sistemas SET activo=false WHERE id='pesca'");
  assert.equal((await t.post('/api/entrar/pesca', {}, cookie)).status, 404);
  await t.pool.query("UPDATE sso_sistemas SET activo=true WHERE id='pesca'");
});
