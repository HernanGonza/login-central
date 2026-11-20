import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from './helpers.js';
import { crearPersonalPrueba } from '../src/personal/prueba.js';
import { resolverCorreo } from '../src/correo.js';

let t;
before(async () => { t = await crearEntorno(); });
after(async () => { await t.cerrar(); });

test('adaptador PRUEBA: busca por correo (minúsculas, trim) y verifica argon2id', async () => {
  const p = crearPersonalPrueba(t.pool);
  const r = await p.buscarPorCorreo('  ANA.Perez@Ecologia.test ');
  assert.equal(r.length, 1);
  assert.deepEqual(Object.keys(r[0]).sort(), ['activo', 'apellido', 'email', 'id', 'nombre']);
  assert.equal(r[0].email, 'ana.perez@ecologia.test');
  const { rows } = await t.pool.query("SELECT clave_hash FROM empleados WHERE id='emp-1001'");
  assert.match(rows[0].clave_hash, /^\$argon2id\$/);
  assert.equal(await p.verificarClave(r[0], 'clave-de-prueba'), true);
  assert.equal(await p.verificarClave(r[0], 'otra'), false);
  assert.equal(await p.verificarClave(r[0], ''), false);
  assert.equal(await p.verificarClave({ id: 'no-existe' }, 'clave-de-prueba'), false);
});

test('resolverCorreo: vacío, no encontrado, duplicado, ok', async () => {
  const p = crearPersonalPrueba(t.pool);
  assert.equal((await resolverCorreo(p, '')).estado, 'vacio');
  assert.equal((await resolverCorreo(p, '   ')).estado, 'vacio');
  assert.equal((await resolverCorreo(p, undefined)).estado, 'vacio');
  assert.equal((await resolverCorreo(p, 'nadie@ecologia.test')).estado, 'no_encontrado');
  assert.equal((await resolverCorreo(p, 'REPETIDO@ecologia.test')).estado, 'duplicado');
  assert.equal((await resolverCorreo(p, 'Ana.Perez@ecologia.test')).estado, 'ok');
});

test('POST /api/ingreso: correo vacío -> "No encontramos tu correo" + enlace al registro', async () => {
  const r = await t.ingresar('');
  assert.equal(r.status, 400);
  assert.equal(r.json.mensaje, 'No encontramos tu correo');
  assert.equal(r.json.registroUrl, 'https://personal.invalid/registro');
  assert.equal(r.headers.get('set-cookie'), null);
});

test('POST /api/ingreso: correo no encontrado -> mensaje + registro, sin sesión', async () => {
  const r = await t.ingresar('nadie@ecologia.test');
  assert.equal(r.status, 404);
  assert.equal(r.json.mensaje, 'No encontramos tu correo');
  assert.equal(r.json.registroUrl, 'https://personal.invalid/registro');
  assert.equal(r.headers.get('set-cookie'), null);
});

test('POST /api/ingreso: correo duplicado -> no hay sesión ni pases, mensaje de desarrollo', async () => {
  const antes = (await t.pool.query('SELECT count(*)::int n FROM jti_usados')).rows[0].n;
  const r = await t.ingresar('repetido@ecologia.test');
  assert.equal(r.status, 409);
  assert.equal(r.json.mensaje,
    'Tu correo figura más de una vez. Contactate con el equipo de desarrollo: desarrollo@ecologia.misiones.gob.ar');
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(JSON.stringify(r.json).includes('eyJ'), false);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM sso_sesiones')).rows[0].n, 0);
  assert.equal((await t.pool.query('SELECT count(*)::int n FROM jti_usados')).rows[0].n, antes);
});

test('duplicado que aparece después del ingreso: /api/entrar no emite pase', async () => {
  const cookie = await t.sesion('luis.gomez@ecologia.test');
  await t.pool.query(
    "INSERT INTO empleados (id,email,nombre,apellido,activo,clave_hash) SELECT 'emp-9999',email,'Otro','Luis',true,clave_hash FROM empleados WHERE id='emp-1002'");
  const r = await t.post('/api/entrar/wiki', {}, cookie);
  assert.equal(r.status, 403);
  assert.equal(r.json.token, undefined);
  await t.pool.query("DELETE FROM empleados WHERE id='emp-9999'");
});
