import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { iniciar } from '../src/servidor.mjs';
import { cargarUsuarios, USUARIOS_DEFECTO } from '../src/usuarios.mjs';
import http from 'node:http';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/sso/vectores');
const V = JSON.parse(readFileSync(path.join(dir, 'vectores.PRUEBA.json'), 'utf8'));
const JWKS = readFileSync(path.join(dir, V.jwks), 'utf8');
const PORTAL = 'https://portal.prueba.invalid';
// JWKS servido por un servidor HTTP efímero (el kit real lo pide por URL).
const jwksServer = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JWKS); });
await new Promise((ok) => jwksServer.listen(0, '127.0.0.1', ok));
const config = {
  issuer: V.iss, audience: V.aud_esperada, ahora: () => V.ahora, cooldownJwks: 0,
  jwksUrl: `http://127.0.0.1:${jwksServer.address().port}/.well-known/jwks.json`, portalUrl: PORTAL,
  cookieSecure: true, control: true, retardoLentoMs: 300,
};
const abiertos = [];
after(async () => { await Promise.all(abiertos.map((s) => s.apagar())); jwksServer.closeAllConnections(); jwksServer.close(); });
const arrancar = async (usuarios = cargarUsuarios({})) => { const s = await iniciar({ config, usuarios }); abiertos.push(s); return s; };
const tokenDe = (c) => V.casos[c].token;
const post = (url, token) => fetch(`${url}/sso/login`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ token }),
});

test('acceso: correo con rol -> acceso true + rol', async () => {
  const s = await arrancar();
  const r = await fetch(`${s.url}/sso/acceso`, { headers: { authorization: `Bearer ${tokenDe('valido_acceso')}` } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { acceso: true, rol: 'admin' });
  assert.match(r.headers.get('cache-control'), /no-store/);
  await s.apagar();
});

test('acceso: correo en mayúsculas se resuelve igual', async () => {
  const s = await arrancar();
  const r = await fetch(`${s.url}/sso/acceso`, { headers: { authorization: `Bearer ${tokenDe('email_mayusculas')}` } });
  assert.equal(r.status, V.casos.email_mayusculas.use_esperado === 'acceso' ? 200 : 401);
  await s.apagar();
});

test('acceso: correo fuera de la lista o inactivo -> acceso false', async () => {
  for (const lista of [[{ email: 'otro@ecologia.test' }], [{ email: 'ana.perez@ecologia.test', activo: false }]]) {
    const s = await arrancar(cargarUsuarios({ SF_USUARIOS_JSON: JSON.stringify(lista) }));
    const r = await fetch(`${s.url}/sso/acceso`, { headers: { authorization: `Bearer ${tokenDe('valido_acceso')}` } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { acceso: false });
    await s.apagar();
  }
});

test('acceso: sin pase o pase inválido -> 401 sin detalle', async () => {
  const s = await arrancar();
  const sin = await fetch(`${s.url}/sso/acceso`);
  assert.equal(sin.status, 401);
  for (const c of ['vencido', 'firma_ajena', 'alg_none', 'basura', 'valido_login', 'aud_ajeno', 'iss_ajeno', 'kid_desconocido', 'hs256']) {
    const r = await fetch(`${s.url}/sso/acceso`, { headers: { authorization: `Bearer ${tokenDe(c)}` } });
    assert.equal(r.status, 401, c);
    assert.doesNotMatch(await r.text(), /firma|exp|alg|motivo/i);
  }
  await s.apagar();
});

test('login: pase válido -> 302 a inicio con cookie de sesión; inicio muestra la sesión', async () => {
  const s = await arrancar();
  const r = await post(s.url, tokenDe('valido_login'));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
  assert.match(r.headers.get('cache-control'), /no-store/);
  const ck = r.headers.get('set-cookie');
  assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Lax/); assert.match(ck, /Secure/);
  const inicio = await fetch(`${s.url}/`, { headers: { cookie: ck.split(';')[0] } });
  assert.equal(inicio.status, 200);
  const html = await inicio.text();
  assert.match(html, /Ana Pérez/); assert.match(html, /admin/);
  const anon = await fetch(`${s.url}/`);
  assert.equal(anon.status, 401);
  await s.apagar();
});

test('login: correo sin usuario o inactivo -> 403 "sin acceso" con enlace al portal, sin sesión', async () => {
  for (const lista of [[{ email: 'otro@ecologia.test' }], [{ email: 'ana.perez@ecologia.test', activo: false }]]) {
    const s = await arrancar(cargarUsuarios({ SF_USUARIOS_JSON: JSON.stringify(lista) }));
    const r = await post(s.url, tokenDe('valido_login'));
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('set-cookie'), null);
    const cuerpo = await r.text();
    assert.match(cuerpo, new RegExp(`href="${PORTAL}"`));
    assert.doesNotMatch(cuerpo, /volver/);
    await s.apagar();
  }
});

test('login: pase reutilizado (jti) o inválido -> sin sesión', async () => {
  const s = await arrancar();
  assert.equal((await post(s.url, tokenDe('jti_repetido'))).status, 302);
  const dos = await post(s.url, tokenDe('jti_repetido'));
  assert.equal(dos.status, 403);
  assert.equal(dos.headers.get('set-cookie'), null);
  for (const c of ['vencido', 'aud_ajeno', 'iss_ajeno', 'firma_ajena', 'kid_desconocido', 'use_cambiado', 'alg_none', 'hs256', 'basura']) { const r = await post(s.url, tokenDe(c)); assert.equal(r.status, 403, c); assert.equal(r.headers.get('set-cookie'), null); }
  await s.apagar();
});

test('apagar: tras apagar() el puerto no responde (tarjeta gris)', async () => {
  const s = await arrancar();
  await s.apagar();
  await assert.rejects(fetch(`${s.url}/sso/acceso`));
});

test('modo caido y lento vía /_control', async () => {
  const s = await arrancar();
  await fetch(`${s.url}/_control?modo=caido`, { method: 'POST' });
  assert.equal((await fetch(`${s.url}/sso/acceso`)).status, 503);
  await fetch(`${s.url}/_control?modo=lento`, { method: 'POST' });
  const t = Date.now();
  await fetch(`${s.url}/sso/acceso`);
  assert.ok(Date.now() - t >= 250);
  await fetch(`${s.url}/_control?modo=normal`, { method: 'POST' });
  assert.equal((await fetch(`${s.url}/sso/acceso`)).status, 401);
  await s.apagar();
});

test('usuarios: SF_USUARIOS y defecto', () => {
  const l = cargarUsuarios({ SF_USUARIOS: 'A@x.test:admin, !b@x.test, c@x.test' });
  assert.deepEqual(l.map((u) => [u.email, u.rol, u.activo]), [['a@x.test', 'admin', true], ['b@x.test', undefined, false], ['c@x.test', undefined, true]]);
  assert.equal(cargarUsuarios({}).length, USUARIOS_DEFECTO.length);
});

test('/_control: Origin ajeno -> 403; loopback y sin Origin -> 200; token por SF_CONTROL_TOKEN', async () => {
  const s = await arrancar();
  const c = (h) => fetch(`${s.url}/_control?modo=normal`, { method: 'POST', headers: h });
  assert.equal((await c({ origin: 'https://evil.example' })).status, 403);
  assert.equal((await c({ origin: 'null' })).status, 403);
  assert.equal((await c({ origin: 'http://localhost:5173' })).status, 200);
  assert.equal((await c({})).status, 200);
  process.env.SF_CONTROL_TOKEN = 'secreto';
  try {
    assert.equal((await c({})).status, 403);
    assert.equal((await c({ 'x-control-token': 'otro' })).status, 403);
    assert.equal((await c({ 'x-control-token': 'secreto' })).status, 200);
  } finally { delete process.env.SF_CONTROL_TOKEN; }
  await s.apagar();
});

test('sesión vence del lado del servidor a las 8 h', async () => {
  let t = 1_000_000;
  const s = await iniciar({ config: { ...config, relojSesion: () => t }, usuarios: cargarUsuarios({}) });
  abiertos.push(s);
  const r = await post(s.url, tokenDe('valido_login'));
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const ver = () => fetch(`${s.url}/`, { headers: { cookie } });
  assert.equal((await ver()).status, 200);
  t += 28800 * 1000 - 1;
  assert.equal((await ver()).status, 200);
  t += 1;
  assert.equal((await ver()).status, 401);
  assert.equal(s.app.sesiones.size, 0);
  await s.apagar();
});

test('/_control: Host no loopback (DNS rebinding) -> 403; localhost/127.0.0.1/[::1] -> 200', async () => {
  const s = await arrancar();
  const puerto = new URL(s.url).port;
  const pedir = (host) => new Promise((ok, fail) => {
    const r = http.request({ host: '127.0.0.1', port: puerto, path: '/_control?modo=normal', method: 'POST', headers: { host } }, (res) => { res.resume(); ok(res.statusCode); });
    r.on('error', fail); r.end();
  });
  assert.equal(await pedir(`atacante.example:${puerto}`), 403);
  assert.equal(await pedir('atacante.example'), 403);
  assert.equal(await pedir(`localhost.atacante.example:${puerto}`), 403);
  assert.equal(await pedir(`localhost:${puerto}`), 200);
  assert.equal(await pedir(`127.0.0.1:${puerto}`), 200);
  assert.equal(await pedir(`[::1]:${puerto}`), 200);
  await s.apagar();
});

test('CSRF login: Origin del portal funciona (flujo real); Origin ajeno/null o cross-site sin Origin -> 403', async () => {
  const s = await arrancar();
  const p = (token, headers) => fetch(`${s.url}/sso/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ token }),
  });
  assert.equal((await p(tokenDe('valido_login'), { origin: PORTAL, 'sec-fetch-site': 'cross-site' })).status, 302);
  assert.equal((await p(tokenDe('email_mayusculas'), { origin: 'https://evil.example' })).status, 403);
  assert.equal((await p(tokenDe('email_mayusculas'), { origin: 'null' })).status, 403);
  assert.equal((await p(tokenDe('email_mayusculas'), { 'sec-fetch-site': 'cross-site' })).status, 403);
  await s.apagar();
});

test('cookie mal formada (%E0%A4%A) -> 401 sin sesión, no lanza', async () => {
  const s = await arrancar();
  for (const v of ['%E0%A4%A', '%', '%zz']) {
    const r = await fetch(`${s.url}/`, { headers: { cookie: `sf_sesion_${V.aud_esperada.replace(/[^a-z0-9_-]/gi, '')}=${v}; otra=%` } });
    assert.equal(r.status, 401, v);
  }
  await s.apagar();
});
