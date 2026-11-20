import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import argon2 from 'argon2';
import { crearEntorno, CLAVE, ENV_PROD, HMAC_LARGA } from './helpers.js';
import { leerConfig, leerTrustProxy, leerBasePath } from '../src/config.js';
import { prepararArranque } from '../src/arranque.js';
import { crearUsuario, listarUsuarios, desactivarUsuario } from '../src/usuarios.js';
import { cargarSistemas } from '../src/sistemas.js';
import { purgar } from '../src/purga.js';
import { crearPool } from '../src/db.js';

const BASE = { DATABASE_URL: 'postgres://x', SSO_ISSUER: 'https://i.invalid', PORTAL_URL: 'https://p.invalid' };
const PROD = { ...BASE, NODE_ENV: 'production', ALTCHA_HMAC_KEY: HMAC_LARGA, PERSONAL_ADAPTER: 'externo' };
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

test('adaptador de prueba en producción: exige PORTAL_PERMITIR_ADAPTADOR_PRUEBA=1', () => {
  const e = { ...PROD, PERSONAL_ADAPTER: 'prueba' };
  assert.throws(() => leerConfig(e), /PORTAL_PERMITIR_ADAPTADOR_PRUEBA/);
  assert.throws(() => leerConfig({ ...e, PORTAL_PERMITIR_ADAPTADOR_PRUEBA: 'true' }), /PORTAL_PERMITIR/);
  assert.equal(leerConfig({ ...e, PORTAL_PERMITIR_ADAPTADOR_PRUEBA: '1' }).modoPrueba, true);
  assert.equal(leerConfig({ ...BASE, NODE_ENV: 'development' }).modoPrueba, false);
});

test('modo prueba: sin semillas, crea empleados, aviso y /api/config.modo_prueba', async () => {
  const t = await crearEntorno({ env: { ...ENV_PROD } });
  try {
    await t.pool.query('DROP TABLE IF EXISTS empleados; DELETE FROM sso_sistemas');
    const avisos = [];
    await prepararArranque({ config: t.config, pool: t.pool, log: t.log, aviso: (x) => avisos.push(x) });
    await prepararArranque({ config: t.config, pool: t.pool, log: t.log, aviso: () => {} }); // idempotente
    assert.equal((await t.pool.query('SELECT count(*)::int n FROM empleados')).rows[0].n, 0);
    assert.equal((await t.pool.query('SELECT count(*)::int n FROM sso_sistemas')).rows[0].n, 0);
    assert.match(avisos[0], /MODO PRUEBA/);
    assert.ok(t.lineas.some((l) => l.includes('aviso_modo_prueba')));
    assert.equal((await t.get('/api/config')).json.modo_prueba, true);
  } finally { await t.cerrar(); }
  const d = await crearEntorno();
  try { assert.equal((await d.get('/api/config')).json.modo_prueba, false); } finally { await d.cerrar(); }
});

test('usuarios: crear (minúsculas, argon2id), duplicado, listar sin hashes, desactivar', async () => {
  const t = await crearEntorno();
  try {
    const u = await crearUsuario(t.pool, { email: '  Nuevo@Ecologia.TEST ', nombre: 'N', apellido: 'A', clave: 'una-clave-larga' });
    assert.equal(u.email, 'nuevo@ecologia.test');
    const { rows } = await t.pool.query('SELECT clave_hash FROM empleados WHERE id=$1', [u.id]);
    assert.match(rows[0].clave_hash, /^\$argon2id\$/);
    assert.ok(await argon2.verify(rows[0].clave_hash, 'una-clave-larga'));
    await assert.rejects(crearUsuario(t.pool, { email: 'NUEVO@ecologia.test', nombre: 'x', apellido: 'y', clave: 'otra-clave-larga' }), /ya existe/);
    await assert.rejects(crearUsuario(t.pool, { email: 'malo', nombre: 'x', apellido: 'y', clave: 'otra-clave-larga' }), /correo/);
    await assert.rejects(crearUsuario(t.pool, { email: 'b@e.test', nombre: 'x', apellido: 'y', clave: 'corta' }), /clave/);
    assert.ok(!JSON.stringify(await listarUsuarios(t.pool)).includes('argon2'));
    await desactivarUsuario(t.pool, 'Nuevo@ecologia.test');
    assert.equal((await t.pool.query('SELECT activo FROM empleados WHERE id=$1', [u.id])).rows[0].activo, false);
    await assert.rejects(desactivarUsuario(t.pool, 'nadie@ecologia.test'), /no existe/);
  } finally { await t.cerrar(); }
});

test('CLI: --help, crear con --generar (clave una vez, usable), stdin, listar, desactivar, sistemas', async () => {
  const t = await crearEntorno();
  const dir = mkdtempSync(join(tmpdir(), 'cli-'));
  try {
    const env = { ...process.env, DATABASE_URL: t.config.databaseUrl, SSO_ISSUER: 'https://i.invalid', PORTAL_URL: 'https://p.invalid',
      NODE_ENV: 'development', PERSONAL_ADAPTER: 'prueba' };
    const cli = (f, args, input) => spawnSync(process.execPath, [join(raiz, 'src/cli', f), ...args], { env, input, encoding: 'utf8' });
    for (const f of ['usuarios-crear', 'usuarios-listar', 'usuarios-desactivar', 'sistemas-cargar', 'sistemas-listar']) {
      assert.match(cli(`${f}.js`, ['--help']).stdout, /Uso: npm run/);
    }
    const g = cli('usuarios-crear.js', ['--email', 'Gen@Ecologia.test', '--nombre', 'G', '--apellido', 'H', '--generar']);
    assert.equal(g.status, 0, g.stderr);
    const clave = g.stdout.match(/una sola vez\): (\S+)/)?.[1];
    assert.ok(clave && clave.length >= 20);
    assert.equal((await t.ingresar('gen@ecologia.test', clave)).status, 200);
    const s = cli('usuarios-crear.js', ['--email', 'stdin@ecologia.test', '--nombre', 'S', '--apellido', 'T', '--clave-stdin'], 'clave-por-stdin-1\n');
    assert.equal(s.status, 0, s.stderr);
    assert.doesNotMatch(s.stdout + s.stderr, /clave-por-stdin-1/);
    assert.equal((await t.ingresar('stdin@ecologia.test', 'clave-por-stdin-1')).status, 200);
    const dup = cli('usuarios-crear.js', ['--email', 'stdin@ecologia.test', '--nombre', 'S', '--apellido', 'T', '--clave-stdin'], 'clave-por-stdin-2');
    assert.equal(dup.status, 1); assert.match(dup.stderr, /ya existe/);
    const l = cli('usuarios-listar.js', []);
    assert.match(l.stdout, /stdin@ecologia.test/); assert.doesNotMatch(l.stdout, /argon2/);
    assert.equal(cli('usuarios-desactivar.js', ['--email', 'stdin@ecologia.test']).status, 0);
    assert.match(cli('usuarios-listar.js', []).stdout, /stdin@ecologia.test\tS T\tINACTIVO/);
    const json = join(dir, 's.json');
    writeFileSync(json, JSON.stringify([{ id: 'nuevo', nombre: 'Nuevo', url_login: 'https://n.test/sso/login', url_acceso: 'https://n.test/sso/acceso', siempre_visible: true }]));
    const c = cli('sistemas-cargar.js', [json]);
    assert.equal(c.status, 0, c.stderr);
    assert.match(cli('sistemas-listar.js', []).stdout, /nuevo\tactivo\tsiempre_visible/);
    const prod = spawnSync(process.execPath, [join(raiz, 'src/cli/sistemas-cargar.js'), json],
      { env: { ...env, ...PROD, DATABASE_URL: env.DATABASE_URL }, encoding: 'utf8' });
    assert.equal(prod.status, 0, prod.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); await t.cerrar(); }
});

test('sistemas:cargar valida http(s), https en producción, ids repetidos y es todo o nada', async () => {
  const t = await crearEntorno();
  try {
    const ok = { id: 'a1', nombre: 'A', url_login: 'https://a.test/l', url_acceso: 'https://a.test/a' };
    await cargarSistemas(t.pool, [ok], { produccion: true });
    await cargarSistemas(t.pool, [{ ...ok, nombre: 'A2', activo: false }], { produccion: true }); // upsert
    const f = (await t.pool.query("SELECT nombre, activo FROM sso_sistemas WHERE id='a1'")).rows[0];
    assert.deepEqual(f, { nombre: 'A2', activo: false });
    await assert.rejects(cargarSistemas(t.pool, [{ ...ok, id: 'b', url_login: 'http://a.test/l' }], { produccion: true }), /https/);
    await cargarSistemas(t.pool, [{ ...ok, id: 'b', url_login: 'http://a.test/l', url_acceso: 'http://a.test/a' }], { produccion: false });
    for (const malo of ['javascript:alert(1)', 'ftp://a.test/', 'no-url']) {
      await assert.rejects(cargarSistemas(t.pool, [{ ...ok, id: 'c', url_acceso: malo }], { produccion: false }), /url_acceso/);
    }
    await assert.rejects(cargarSistemas(t.pool, [ok, ok], { produccion: false }), /repetido/);
    await assert.rejects(cargarSistemas(t.pool, [{ ...ok, id: 'ok2' }, { ...ok, id: 'MAL ID' }], { produccion: false }), /id/);
    assert.equal((await t.pool.query("SELECT count(*)::int n FROM sso_sistemas WHERE id='ok2'")).rows[0].n, 0);
  } finally { await t.cerrar(); }
});

test('tope global por correo no bloquea a IPs con ingreso exitoso previo (30 días); sí a otras', async () => {
  const t = await crearEntorno({ env: { TRUST_PROXY: '1', LIMITE_POR_PAR: '50', LIMITE_POR_IP: '100', LIMITE_POR_CORREO: '4' } });
  const desde = (ip, email, clave) => t.solucion().then((altcha) => fetch(`${t.url}/api/ingreso`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ email, clave, altcha }) }).then((r) => r.status));
  try {
    const mail = 'luis.gomez@ecologia.test';
    assert.equal(await desde('198.51.100.7', mail, CLAVE), 200); // IP conocida
    for (let i = 1; i <= 4; i++) assert.equal(await desde(`192.0.2.${i}`, mail, 'mala'), 401);
    assert.equal(await desde('192.0.2.99', mail, CLAVE), 429, 'IP desconocida: tope global');
    assert.equal(await desde('198.51.100.7', mail, CLAVE), 200, 'IP con ingreso previo: pasa');
    // La purga conserva los ok 30 días y descarta los fallos viejos.
    await t.pool.query("UPDATE intentos_ingreso SET creado = now() - interval '2 hours'");
    await purgar(t.pool, t.config);
    assert.equal((await t.pool.query('SELECT count(*)::int n FROM intentos_ingreso WHERE ok=false')).rows[0].n, 0);
    assert.ok((await t.pool.query('SELECT count(*)::int n FROM intentos_ingreso WHERE ok=true')).rows[0].n >= 1);
    await t.pool.query("UPDATE intentos_ingreso SET creado = now() - interval '31 days'");
    await purgar(t.pool, t.config);
    assert.equal((await t.pool.query('SELECT count(*)::int n FROM intentos_ingreso')).rows[0].n, 0);
  } finally { await t.cerrar(); }
});

test('TRUST_PROXY: rechaza rangos demasiado anchos y acepta razonables', () => {
  for (const malo of ['0.0.0.0/0', '10.0.0.0/7', '::/0', '2001::/15', '0.0.0.0/4']) assert.throws(() => leerTrustProxy(malo, true), /ancho/, malo);
  for (const ok of ['10.0.0.0/8', '172.16.0.0/12', 'fd00::/16', '127.0.0.1', '::1', 'loopback,uniquelocal,linklocal', '2']) {
    assert.doesNotThrow(() => leerTrustProxy(ok, true), ok);
  }
  for (const malo of ['*', 'all', 'a.b.c.d', '11', '1,2']) assert.throws(() => leerTrustProxy(malo, true), malo);
});

test('TRUST_PROXY=2 (ecodatos + nginx del portal): la IP es la del cliente; un X-Forwarded-For falso no la cambia', async () => {
  const t = await crearEntorno({ env: { TRUST_PROXY: '2' } });
  const ipLog = async (xff) => {
    t.lineas.length = 0;
    await fetch(`${t.url}/api/ingreso`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff }, body: '{}' });
    return JSON.parse(t.lineas.find((l) => l.includes('ingreso_rechazado'))).ip;
  };
  try {
    // cliente -> nginx ecodatos (agrega cliente) -> nginx portal (agrega IP de ecodatos); el socket es el nginx del portal.
    assert.equal(await ipLog('203.0.113.50, 10.9.9.9'), '203.0.113.50');
    // el cliente intentó falsear con "6.6.6.6": queda a la izquierda y se ignora
    assert.equal(await ipLog('6.6.6.6, 203.0.113.50, 10.9.9.9'), '203.0.113.50');
  } finally { await t.cerrar(); }
});

test('/api POST sin Origin: Sec-Fetch-Site cross-site se rechaza; same-origin/ausente pasa; Origin ajeno 403', async () => {
  const t = await crearEntorno();
  const post = (h) => fetch(`${t.url}/api/salir`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: '{}' }).then((r) => r.status);
  try {
    assert.equal(await post({ 'Sec-Fetch-Site': 'cross-site' }), 403);
    assert.equal(await post({ 'Sec-Fetch-Site': 'same-origin' }), 200);
    assert.equal(await post({}), 200);
    assert.equal(await post({ Origin: 'https://malo.invalid' }), 403);
    assert.equal(await post({ Origin: 'https://portal.prueba.invalid' }), 200);
  } finally { await t.cerrar(); }
});

test('producción: HMAC >= 32, topes de límites/maxnumber y URLs de Personal https/mailto', () => {
  assert.doesNotThrow(() => leerConfig(PROD));
  assert.throws(() => leerConfig({ ...PROD, ALTCHA_HMAC_KEY: 'x'.repeat(31) }), /32/);
  assert.doesNotThrow(() => leerConfig({ ...BASE, NODE_ENV: 'development', ALTCHA_HMAC_KEY: 'corta', PERSONAL_ADAPTER: 'externo' }));
  for (const [k, v] of [['ALTCHA_MAXNUMBER', '9999'], ['ALTCHA_MAXNUMBER', '99999999'], ['LIMITE_POR_IP', '10001'],
    ['LIMITE_POR_PAR', '10001'], ['LIMITE_POR_CORREO', '100000'], ['LIMITE_ENTRAR_MIN', '10001'], ['ALTCHA_LIMITE_IP_MIN', '10001'],
    ['LIMITE_VENTANA_SEG', '5']]) assert.throws(() => leerConfig({ ...PROD, [k]: v }), new RegExp(k), `${k}=${v}`);
  assert.equal(leerConfig({ ...PROD, ALTCHA_MAXNUMBER: '10000', LIMITE_POR_IP: '10000' }).limites.porIp, 10000);
  for (const k of ['PERSONAL_REGISTRO_URL', 'PERSONAL_RECUPERO_URL']) {
    for (const malo of ['http://p.test/r', 'javascript:alert(1)', 'p.test/r', 'ftp://p.test']) assert.throws(() => leerConfig({ ...PROD, [k]: malo }), new RegExp(k), malo);
    assert.equal(leerConfig({ ...PROD, [k]: 'https://p.test/r' })[k === 'PERSONAL_REGISTRO_URL' ? 'registroUrl' : 'recuperoUrl'], 'https://p.test/r');
    assert.doesNotThrow(() => leerConfig({ ...PROD, [k]: 'mailto:rrhh@ecologia.misiones.gob.ar' }));
  }
});

test('PORTAL_BASE_PATH: formato, cookie con Path, Origin por origen y iss exacto con path en las URLs', async () => {
  assert.equal(leerBasePath(undefined), '/');
  assert.equal(leerBasePath('/portal/'), '/portal');
  for (const malo of ['portal', '/a/../b', '//x', '/a//b', '/..', '/a?b', '/a b', 'https://x']) assert.throws(() => leerBasePath(malo), /PORTAL_BASE_PATH/, malo);
  assert.equal(leerConfig({ ...PROD, SSO_ISSUER: 'https://e.test/portal', PORTAL_URL: 'https://e.test/portal', PORTAL_BASE_PATH: '/portal' }).basePath, '/portal');
  assert.throws(() => leerConfig({ ...PROD, SSO_ISSUER: 'http://e.test/portal' }), /https/);
  const t = await crearEntorno({ env: { PORTAL_BASE_PATH: '/portal', SSO_ISSUER: 'https://e.test/portal', PORTAL_URL: 'https://e.test/portal' } });
  try {
    const post = (h) => fetch(`${t.url}/api/salir`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: '{}' }).then((r) => r.status);
    assert.equal(await post({ Origin: 'https://e.test' }), 200, 'compara solo el origen');
    assert.equal(await post({ Origin: 'https://e.test/portal' }), 403, 'un Origin real nunca lleva path');
    const r = await t.ingresar('ana.perez@ecologia.test');
    const sc = r.headers.getSetCookie()[0];
    assert.match(sc, /Path=\/portal(;|$)/);
    assert.doesNotMatch(sc, /Path=\/;/);
    const cookie = sc.split(';')[0];
    const { token } = (await t.post('/api/entrar/wiki', {}, cookie)).json;
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    assert.equal(payload.iss, 'https://e.test/portal');
  } finally { await t.cerrar(); }
});
