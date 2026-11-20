import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno, CLAVE } from './helpers.js';

let t;
before(async () => {
  t = await crearEntorno({ env: { LIMITE_POR_PAR: '3', LIMITE_POR_IP: '8' } });
});
after(async () => { await t.cerrar(); });

test('ingreso correcto: cookie HttpOnly, Secure, SameSite=Lax, 8 h; sin pases en la respuesta', async () => {
  const r = await t.ingresar('ana.perez@ecologia.test');
  assert.equal(r.status, 200);
  const c = r.headers.getSetCookie()[0];
  assert.match(c, /HttpOnly/i);
  assert.match(c, /Secure/i);
  assert.match(c, /SameSite=Lax/i);
  assert.match(c, /Max-Age=28800/);
  assert.equal(r.json.nombre, 'Ana');
  assert.equal(JSON.stringify(r.json).includes('eyJ'), false);
  // La cookie no se guarda en claro.
  const valor = c.split(';')[0].split('=')[1];
  const { rows } = await t.pool.query('SELECT id_hash FROM sso_sesiones');
  assert.ok(rows.every((x) => x.id_hash !== valor));
  const s = await t.get('/api/sesion', c.split(';')[0]);
  assert.equal(s.json.empleado.nombre, 'Ana');
});

test('sin cookie -> 401; salir invalida la sesión', async () => {
  assert.equal((await t.get('/api/tarjetas')).status, 401);
  const cookie = await t.sesion();
  assert.equal((await t.get('/api/sesion', cookie)).status, 200);
  assert.equal((await t.post('/api/salir', {}, cookie)).status, 200);
  assert.equal((await t.get('/api/sesion', cookie)).status, 401);
});

test('cookie Secure se puede apagar solo por variable (desarrollo http)', async () => {
  const d = await crearEntorno({ env: { COOKIE_SECURE: 'false' } });
  try {
    const r = await d.ingresar('ana.perez@ecologia.test');
    assert.doesNotMatch(r.headers.getSetCookie()[0], /Secure/i);
  } finally { await d.cerrar(); }
});

test('captcha: sin solución, inválida o repetida -> 400', async () => {
  const base = { email: 'ana.perez@ecologia.test', clave: CLAVE };
  assert.equal((await t.post('/api/ingreso', base)).json.error, 'captcha');
  assert.equal((await t.post('/api/ingreso', { ...base, altcha: 'basura' })).status, 400);
  const sol = await t.solucion();
  const roto = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(sol, 'base64')), number: 1 })).toString('base64');
  assert.equal((await t.post('/api/ingreso', { ...base, altcha: roto })).status, 400);
  assert.equal((await t.post('/api/ingreso', { ...base, altcha: sol })).status, 200);
  const rep = await t.post('/api/ingreso', { ...base, altcha: sol });
  assert.equal(rep.status, 400);
  assert.equal(rep.json.error, 'captcha');
});

test('límite por par correo+IP: tras 3 fallos, 429 incluso con la clave correcta', async () => {
  const mail = 'luis.gomez@ecologia.test';
  for (let i = 0; i < 3; i++) assert.equal((await t.ingresar(mail, 'mala')).status, 401);
  const r = await t.ingresar(mail, CLAVE);
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.equal(r.headers.get('set-cookie'), null);
  // Otro correo, misma IP: todavía permitido.
  assert.equal((await t.ingresar('ana.perez@ecologia.test')).status, 200);
});

test('límite por IP: correos distintos inexistentes agotan el cupo de la IP', async () => {
  await t.pool.query('DELETE FROM intentos_ingreso');
  for (let i = 0; i < 8; i++) assert.equal((await t.ingresar(`x${i}@ecologia.test`)).status, 404);
  const r = await t.ingresar('ana.perez@ecologia.test');
  assert.equal(r.status, 429);
});

test('un ingreso exitoso borra los fallos de ese correo', async () => {
  await t.pool.query('DELETE FROM intentos_ingreso');
  await t.ingresar('ana.perez@ecologia.test', 'mala');
  await t.ingresar('ana.perez@ecologia.test', 'mala');
  assert.equal((await t.ingresar('ana.perez@ecologia.test')).status, 200);
  const n = (await t.pool.query("SELECT count(*)::int n FROM intentos_ingreso WHERE correo='ana.perez@ecologia.test' AND ok=false")).rows[0].n;
  assert.equal(n, 0);
});

test('usuario inactivo: no entra aunque la clave sea correcta', async () => {
  await t.pool.query('DELETE FROM intentos_ingreso');
  const r = await t.ingresar('baja@ecologia.test');
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('set-cookie'), null);
});

test('volver: solo ids de sso_sistemas activos; otro valor se ignora', async () => {
  await t.pool.query('DELETE FROM intentos_ingreso');
  assert.equal((await t.ingresar('ana.perez@ecologia.test', CLAVE, { volver: 'wiki' })).json.volver, 'wiki');
  for (const malo of ['https://malo.invalid', '//malo.invalid', 'no-existe', '', 123, { a: 1 }, 'wiki/../x']) {
    assert.equal((await t.ingresar('ana.perez@ecologia.test', CLAVE, { volver: malo })).json.volver, null, String(malo));
  }
  const cookie = await t.sesion();
  assert.equal((await t.get('/api/sesion?volver=pesca', cookie)).json.volver, 'pesca');
  assert.equal((await t.get('/api/sesion?volver=http://malo.invalid', cookie)).json.volver, null);
  await t.pool.query("UPDATE sso_sistemas SET activo=false WHERE id='pesca'");
  assert.equal((await t.get('/api/sesion?volver=pesca', cookie)).json.volver, null);
  await t.pool.query("UPDATE sso_sistemas SET activo=true WHERE id='pesca'");
});

test('POST desde otro origen se rechaza', async () => {
  const r = await fetch(`${t.url}/api/salir`, { method: 'POST', headers: { Origin: 'https://malo.invalid' } });
  assert.equal(r.status, 403);
});

test('logs sin secretos, claves, cookies ni pases', async () => {
  await t.pool.query('DELETE FROM intentos_ingreso');
  const cookie = await t.sesion();
  const e = await t.post('/api/entrar/wiki', {}, cookie);
  assert.equal(e.status, 200);
  await t.ingresar('ana.perez@ecologia.test', 'clave-mala-secreta');
  const log = t.lineas.join('\n');
  assert.ok(log.includes('entrar_ok'));
  assert.equal(log.includes(e.json.token), false);
  assert.equal(log.includes('eyJ'), false);
  assert.equal(log.includes(cookie.split('=')[1]), false);
  assert.equal(log.includes('clave-mala-secreta'), false);
  assert.equal(log.includes(CLAVE), false);
});
