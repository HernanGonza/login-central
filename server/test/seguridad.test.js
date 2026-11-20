import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno, CLAVE, ENV_PROD, HMAC_LARGA } from './helpers.js';
import { leerConfig, leerTrustProxy } from '../src/config.js';
import { sembrarSistemas } from '../src/db.js';
import { purgar } from '../src/purga.js';

const BASE = { DATABASE_URL: 'postgres://x', SSO_ISSUER: 'https://i.invalid', PORTAL_URL: 'https://p.invalid', PERSONAL_ADAPTER: 'externo' };

test('carrera de límites: N ingresos concurrentes con clave mala no superan el límite del par', async () => {
  const t = await crearEntorno({ env: { LIMITE_POR_PAR: '3', LIMITE_POR_IP: '1000' } });
  try {
    const N = 15;
    const sols = await Promise.all(Array.from({ length: N }, () => t.solucion()));
    const rs = await Promise.all(sols.map((altcha) =>
      t.post('/api/ingreso', { email: 'luis.gomez@ecologia.test', clave: 'mala', altcha })));
    const cuenta = (c) => rs.filter((r) => r.status === c).length;
    assert.equal(cuenta(401), 3, 'exactamente el límite llega a verificar la clave');
    assert.equal(cuenta(429), N - 3);
    const { rows } = await t.pool.query("SELECT count(*)::int n FROM intentos_ingreso WHERE ok=false AND pendiente=false");
    assert.equal(rows[0].n, 3);
    assert.equal((await t.pool.query('SELECT count(*)::int n FROM intentos_ingreso WHERE pendiente')).rows[0].n, 0);
  } finally { await t.cerrar(); }
});

test('carrera de límites: correos distintos concurrentes no superan el límite por IP', async () => {
  const t = await crearEntorno({ env: { LIMITE_POR_IP: '4' } });
  try {
    const N = 14;
    const sols = await Promise.all(Array.from({ length: N }, () => t.solucion()));
    const rs = await Promise.all(sols.map((altcha, i) =>
      t.post('/api/ingreso', { email: `n${i}@ecologia.test`, clave: 'x', altcha })));
    assert.equal(rs.filter((r) => r.status === 404).length, 4);
    assert.equal(rs.filter((r) => r.status === 429).length, N - 4);
  } finally { await t.cerrar(); }
});

test('el intento se reserva antes de verificar la clave (cuenta mientras está pendiente)', async () => {
  let vistos;
  let t;
  t = await crearEntorno({
    env: { LIMITE_POR_PAR: '3' },
    envolverPersonal: (p) => ({
      ...p,
      async verificarClave(e, c) {
        vistos = (await t.pool.query("SELECT count(*)::int n FROM intentos_ingreso WHERE pendiente AND ok=false")).rows[0].n;
        return p.verificarClave(e, c);
      },
    }),
  });
  try {
    await t.ingresar('ana.perez@ecologia.test', CLAVE);
    assert.equal(vistos, 1);
  } finally { await t.cerrar(); }
});

test('TRUST_PROXY: saltos o lista de IPs; true se rechaza en producción', () => {
  assert.equal(leerTrustProxy('1', true), 1);
  assert.equal(leerTrustProxy('', true), false);
  assert.deepEqual(leerTrustProxy('10.0.0.1, 192.168.0.0/16, loopback', true), ['10.0.0.1', '192.168.0.0/16', 'loopback']);
  assert.equal(leerTrustProxy('true', false), true);
  assert.throws(() => leerTrustProxy('true', true), /producción/);
  for (const malo of ['basura', '10.0.0.1/99', '1.2.3.4/8/9', '-1', '999']) assert.throws(() => leerTrustProxy(malo, false), String(malo));
  assert.throws(() => leerConfig({ ...BASE, NODE_ENV: 'production', ALTCHA_HMAC_KEY: HMAC_LARGA, TRUST_PROXY: 'true' }), /TRUST_PROXY/);
});

test('ALTCHA: maxnumber ~1e6 por defecto, resoluble en pocos segundos; clave obligatoria fuera de desarrollo', async () => {
  const c = leerConfig({ ...BASE, ALTCHA_HMAC_KEY: HMAC_LARGA });
  assert.equal(c.altcha.maxnumber, 1_000_000);
  assert.throws(() => leerConfig({ ...BASE, NODE_ENV: 'production' }), /ALTCHA_HMAC_KEY/);
  assert.throws(() => leerConfig({ ...BASE }), /ALTCHA_HMAC_KEY/, 'sin NODE_ENV=development tampoco hay clave efímera');
  assert.equal(leerConfig({ ...BASE, NODE_ENV: 'development' }).desarrollo, true);
  assert.equal(leerConfig({ ...BASE, ALTCHA_HMAC_KEY: HMAC_LARGA, NODE_ENV: 'staging' }).desarrollo, false);
  // Peor caso (number = maxnumber) con el mismo SHA-256 que usa el widget.
  const t = await crearEntorno({ env: { ALTCHA_MAXNUMBER: '1000000' } });
  try {
    const ch = await t.get('/api/altcha');
    assert.equal(ch.json.maxnumber, 1_000_000);
    const { createHash } = await import('node:crypto');
    const ini = Date.now();
    for (let n = 0; n <= 1_000_000; n++) createHash('sha256').update(ch.json.salt + n).digest('hex');
    const ms = Date.now() - ini;
    console.log(`  peor caso 1e6 SHA-256 en Node: ${ms} ms`);
    assert.ok(ms < 15000);
  } finally { await t.cerrar(); }
});

test('/api/altcha: límite de pedidos por IP', async () => {
  const t = await crearEntorno({ env: { ALTCHA_LIMITE_IP_MIN: '3' } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await t.get('/api/altcha')).status, 200);
    const r = await t.get('/api/altcha');
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
  } finally { await t.cerrar(); }
});

test('tiempo: el empleado inactivo también pasa por verificarClave (mismo costo que clave mala); mensajes intactos', async () => {
  const llamadas = [];
  const t = await crearEntorno({
    envolverPersonal: (p) => ({
      ...p,
      async verificarClave(e, c) { llamadas.push(e.email); return p.verificarClave(e, c); },
    }),
  });
  try {
    const inactivo = await t.ingresar('baja@ecologia.test', CLAVE);
    assert.equal(inactivo.status, 401);
    assert.deepEqual(llamadas, ['baja@ecologia.test']);
    const malo = await t.ingresar('ana.perez@ecologia.test', 'mala');
    assert.equal(malo.status, 401);
    assert.deepEqual(inactivo.json, malo.json);
    assert.equal((await t.ingresar('nadie@ecologia.test')).status, 404);
    assert.equal((await t.ingresar('repetido@ecologia.test')).status, 409);
    assert.equal((await t.ingresar('   ')).status, 400);
  } finally { await t.cerrar(); }
});

test('logs: un error de body-parser registra solo el tipo, nunca err.message', async () => {
  const t = await crearEntorno();
  try {
    const r = await fetch(`${t.url}/api/ingreso`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{"clave":"SECRETO-EN-EL-CUERPO", roto',
    });
    assert.equal(r.status, 400);
    const log = t.lineas.join('\n');
    assert.match(log, /"evento":"error"/);
    assert.match(log, /entity\.parse\.failed/);
    assert.equal(log.includes('SECRETO'), false);
    assert.equal(log.includes('Unexpected'), false);
    assert.ok(r.headers.get('content-security-policy'), 'también las respuestas de error llevan cabeceras');
  } finally { await t.cerrar(); }
});

test('cabeceras de seguridad y CSP con form-action a los url_login activos', async () => {
  const t = await crearEntorno();
  try {
    const h = (await t.get('/api/config')).headers;
    const csp = h.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    const fa = csp.match(/form-action ([^;]+)/)[1].split(' ').sort();
    assert.deepEqual(fa, ["'self'", 'http://personal.invalid', 'http://pesca.invalid', 'http://wiki.invalid'].sort());
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.equal(h.get('referrer-policy'), 'strict-origin');
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('strict-transport-security'), null, 'HSTS solo en producción');
  } finally { await t.cerrar(); }
  const p = await crearEntorno({ env: { ...ENV_PROD } });
  try {
    assert.match((await p.get('/api/config')).headers.get('strict-transport-security'), /max-age=\d+/);
  } finally { await p.cerrar(); }
});

test('url_login/url_acceso: solo http(s) al sembrar y al leer', async () => {
  const t = await crearEntorno();
  try {
    await assert.rejects(sembrarSistemas(t.pool, { SISTEMA_WIKI_URL_LOGIN: 'javascript:alert(1)' }), /http/);
    await assert.rejects(sembrarSistemas(t.pool, { SISTEMA_WIKI_URL_ACCESO: 'ftp://x/y' }), /http/);
    await t.pool.query("UPDATE sso_sistemas SET url_login='javascript:alert(1)' WHERE id='wiki'");
    const cookie = await t.sesion();
    assert.equal((await t.get('/api/tarjetas', cookie)).json.tarjetas.some((x) => x.id === 'wiki'), false);
    assert.equal((await t.post('/api/entrar/wiki', {}, cookie)).status, 404);
    assert.doesNotMatch((await t.get('/api/config')).headers.get('content-security-policy'), /javascript/);
  } finally { await t.cerrar(); }
});

test('purga: sesiones vencidas, altcha usados, intentos fuera de ventana y jti viejos', async () => {
  const t = await crearEntorno();
  try {
    const q = (s, p) => t.pool.query(s, p);
    await q("INSERT INTO sso_sesiones (id_hash,empleado_id,email,nombre,expira) VALUES ('v','e','a@b','n', now()-interval '1 hour'),('vivo','e','a@b','n', now()+interval '1 hour')");
    await q("INSERT INTO altcha_usados (firma, expira) VALUES ('viejo', now()-interval '1 minute'),('nuevo', now()+interval '1 minute')");
    await q("INSERT INTO intentos_ingreso (correo,ip,creado) VALUES ('a','1', now()-interval '2 hours'),('b','1', now())");
    await q("INSERT INTO jti_usados (jti,aud,sub,emitido) VALUES ('j1','x','y', now()-interval '40 days'),('j2','x','y', now())");
    const r = await purgar(t.pool, t.config);
    assert.deepEqual(r, { sesiones: 1, altcha: 1, intentos: 1, jti: 1 });
    assert.equal((await q('SELECT count(*)::int n FROM sso_sesiones')).rows[0].n, 1);
    assert.equal((await q('SELECT count(*)::int n FROM intentos_ingreso')).rows[0].n, 1);
  } finally { await t.cerrar(); }
});

test('límite de pedidos: /api/entrar y tarjetas con forzar=1 (por sesión)', async () => {
  const t = await crearEntorno({ env: { LIMITE_ENTRAR_MIN: '2', LIMITE_FORZAR_MIN: '2' } });
  try {
    const cookie = await t.sesion();
    assert.equal((await t.post('/api/entrar/wiki', {}, cookie)).status, 200);
    assert.equal((await t.post('/api/entrar/wiki', {}, cookie)).status, 200);
    const e = await t.post('/api/entrar/wiki', {}, cookie);
    assert.equal(e.status, 429);
    assert.ok(Number(e.headers.get('retry-after')) > 0);
    // Sin forzar no hay tope; con forzar=1 sí.
    for (let i = 0; i < 4; i++) assert.equal((await t.get('/api/tarjetas', cookie)).status, 200);
    assert.equal((await t.get('/api/tarjetas?forzar=1', cookie)).status, 200);
    assert.equal((await t.get('/api/tarjetas/estado?forzar=1', cookie)).status, 200);
    assert.equal((await t.get('/api/tarjetas/wiki/estado?forzar=1', cookie)).status, 429);
    // Otra sesión no se ve afectada.
    const otra = await t.sesion('luis.gomez@ecologia.test');
    assert.equal((await t.post('/api/entrar/wiki', {}, otra)).status, 200);
  } finally { await t.cerrar(); }
});

const desde = (t, ip, email, clave = 'mala') => t.solucion().then((altcha) => fetch(`${t.url}/api/ingreso`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
  body: JSON.stringify({ email, clave, altcha }),
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })));

test('límite por par: bloquea solo (correo, IP); otra IP con el mismo correo entra; la víctima no queda bloqueada', async () => {
  const t = await crearEntorno({ env: { TRUST_PROXY: '1', LIMITE_POR_PAR: '3', LIMITE_POR_CORREO: '50', LIMITE_POR_IP: '100' } });
  try {
    const mail = 'luis.gomez@ecologia.test';
    for (let i = 0; i < 3; i++) assert.equal((await desde(t, '203.0.113.9', mail)).status, 401);
    assert.equal((await desde(t, '203.0.113.9', mail, CLAVE)).status, 429, 'el par atacante queda bloqueado');
    assert.equal((await desde(t, '198.51.100.7', mail, CLAVE)).status, 200, 'la víctima, desde su IP, entra');
    assert.equal((await desde(t, '203.0.113.9', 'ana.perez@ecologia.test', CLAVE)).status, 200, 'la IP atacante no queda bloqueada para otro correo');
  } finally { await t.cerrar(); }
});

test('límite global por IP: muchos correos desde una IP la bloquean; global por correo (alto) frena distribuido', async () => {
  const t = await crearEntorno({ env: { TRUST_PROXY: '1', LIMITE_POR_PAR: '5', LIMITE_POR_CORREO: '6', LIMITE_POR_IP: '4' } });
  try {
    for (let i = 0; i < 4; i++) assert.equal((await desde(t, '203.0.113.9', `q${i}@ecologia.test`)).status, 404);
    assert.equal((await desde(t, '203.0.113.9', 'ana.perez@ecologia.test', CLAVE)).status, 429);
    const mail = 'luis.gomez@ecologia.test';
    for (let i = 0; i < 6; i++) assert.equal((await desde(t, `192.0.2.${i + 1}`, mail)).status, 401);
    assert.equal((await desde(t, '192.0.2.99', mail, CLAVE)).status, 429, 'tope global por correo');
  } finally { await t.cerrar(); }
});

test('par: pocos intentos ajenos desde otras IPs no bloquean a la víctima', async () => {
  const t = await crearEntorno({ env: { TRUST_PROXY: '1', LIMITE_POR_PAR: '3' } });
  try {
    for (let i = 0; i < 10; i++) await desde(t, `192.0.2.${i + 1}`, 'luis.gomez@ecologia.test');
    assert.equal((await desde(t, '198.51.100.7', 'luis.gomez@ecologia.test', CLAVE)).status, 200);
  } finally { await t.cerrar(); }
});

test('carrera concurrente sobre el par: no se supera LIMITE_POR_PAR', async () => {
  const t = await crearEntorno({ env: { TRUST_PROXY: '1', LIMITE_POR_PAR: '3' } });
  try {
    const rs = await Promise.all(Array.from({ length: 14 }, () => desde(t, '203.0.113.9', 'luis.gomez@ecologia.test')));
    assert.equal(rs.filter((r) => r.status === 401).length, 3);
    assert.equal(rs.filter((r) => r.status === 429).length, 11);
  } finally { await t.cerrar(); }
});

test('A) producción (o NODE_ENV distinto de development): exige https y cookie Secure', () => {
  const ok = { ...BASE, ALTCHA_HMAC_KEY: HMAC_LARGA, NODE_ENV: 'production' };
  assert.doesNotThrow(() => leerConfig(ok));
  assert.throws(() => leerConfig({ ...ok, SSO_ISSUER: 'http://i.invalid' }), /SSO_ISSUER.*https/);
  assert.throws(() => leerConfig({ ...ok, PORTAL_URL: 'http://p.invalid' }), /PORTAL_URL.*https/);
  assert.throws(() => leerConfig({ ...ok, COOKIE_SECURE: 'false' }), /COOKIE_SECURE/);
  assert.throws(() => leerConfig({ ...ok, NODE_ENV: undefined, COOKIE_SECURE: 'false' }), /COOKIE_SECURE/);
  assert.throws(() => leerConfig({ ...ok, NODE_ENV: 'staging', SSO_ISSUER: 'http://i.invalid' }), /https/);
  const dev = leerConfig({ ...ok, NODE_ENV: 'development', SSO_ISSUER: 'http://localhost:3000', COOKIE_SECURE: 'false' });
  assert.equal(dev.cookieSecure, false);
});

test('A) url_login/url_acceso: en producción https (http solo localhost); en desarrollo http(s)', async () => {
  const { urlPermitida } = await import('../src/tarjetas.js');
  assert.equal(urlPermitida('https://x.gob.ar/sso', false), true);
  assert.equal(urlPermitida('http://x.gob.ar/sso', false), false);
  assert.equal(urlPermitida('http://localhost:4101/sso', false), true);
  assert.equal(urlPermitida('http://x.invalid/sso', true), true);
  assert.equal(urlPermitida('javascript:alert(1)', true), false);
  const p = await crearEntorno({ env: { ...ENV_PROD } }); // http://*.invalid sembradas -> descartadas
  try {
    const cookie = await p.sesion();
    assert.deepEqual((await p.get('/api/tarjetas', cookie)).json.tarjetas, []);
    assert.match((await p.get('/api/config')).headers.get('content-security-policy'), /form-action 'self'$/);
  } finally { await p.cerrar(); }
});

test('B) límites no numéricos, cero o negativos: error al arrancar (nunca desactivan el límite)', () => {
  const ok = { ...BASE, ALTCHA_HMAC_KEY: HMAC_LARGA };
  for (const k of ['LIMITE_POR_CORREO', 'LIMITE_POR_PAR', 'LIMITE_POR_IP', 'LIMITE_VENTANA_SEG', 'ALTCHA_MAXNUMBER',
    'ALTCHA_LIMITE_IP_MIN', 'LIMITE_ENTRAR_MIN', 'LIMITE_FORZAR_MIN', 'PORT']) {
    for (const malo of ['abc', '0', '-3', '1.5', '5x', 'NaN']) {
      assert.throws(() => leerConfig({ ...ok, [k]: malo }), new RegExp(k), `${k}=${malo}`);
    }
  }
  assert.equal(leerConfig({ ...ok, LIMITE_POR_PAR: '7' }).limites.porPar, 7);
});

test('C) lo inseguro solo con NODE_ENV=development explícito', async () => {
  const ok = { ...BASE, ALTCHA_HMAC_KEY: HMAC_LARGA };
  assert.throws(() => leerConfig({ ...ok, TRUST_PROXY: 'true' }), /TRUST_PROXY/);
  assert.throws(() => leerConfig({ ...ok, NODE_ENV: 'staging', TRUST_PROXY: 'true' }), /TRUST_PROXY/);
  assert.equal(leerConfig({ ...ok, NODE_ENV: 'development', TRUST_PROXY: 'true' }).trustProxy, true);
  assert.equal(leerConfig(ok).produccion, true);
  assert.equal(leerConfig(ok).desarrollo, false);
  const { crearPersonal } = await import('../src/personal/index.js');
  assert.throws(() => crearPersonal({ desarrollo: false, personal: { adaptador: 'prueba' } }, {}), /prueba/);
  assert.doesNotThrow(() => crearPersonal({ desarrollo: true, personal: { adaptador: 'prueba' } }, {}));
  const s = await crearEntorno({ env: { ...ENV_PROD, NODE_ENV: 'staging' } }); // se comporta como producción
  try {
    assert.match((await s.get('/api/config')).headers.get('strict-transport-security'), /max-age/);
  } finally { await s.cerrar(); }
});

test('D) IPv6 se normaliza a /64 para los límites; IPv4 y mapeadas, sin cambio', async () => {
  const { claveIp } = await import('../src/ip.js');
  assert.equal(claveIp('203.0.113.9'), '203.0.113.9');
  assert.equal(claveIp('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(claveIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(claveIp('2001:DB8:1:2::5'), claveIp('2001:db8:1:2:ffff::1'));
  assert.equal(claveIp('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(claveIp('::1'), '0:0:0:0::/64');
  assert.notEqual(claveIp('2001:db8:1:2::1'), claveIp('2001:db8:1:3::1'));
  assert.equal(claveIp(undefined), 'desconocida');
  // Rotar direcciones dentro de un /64 no esquiva el límite del par.
  const t = await crearEntorno({ env: { TRUST_PROXY: '1', LIMITE_POR_PAR: '3' } });
  try {
    for (let i = 1; i <= 3; i++) assert.equal((await desde(t, `2001:db8:1:2::${i}`, 'luis.gomez@ecologia.test')).status, 401);
    assert.equal((await desde(t, '2001:db8:1:2:9::9', 'luis.gomez@ecologia.test', CLAVE)).status, 429);
  } finally { await t.cerrar(); }
});

test('E) una fila inválida en sso_sistemas no rompe nada (no 500) y solo se loguea su id', async () => {
  const t = await crearEntorno();
  try {
    await t.pool.query("UPDATE sso_sistemas SET url_login='esto no es una url' WHERE id='pesca'");
    const r = await t.get('/api/config');
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.headers.get('content-security-policy'), /esto no es/);
    const cookie = await t.sesion();
    const l = await t.get('/api/tarjetas', cookie);
    assert.equal(l.status, 200);
    assert.deepEqual(l.json.tarjetas.map((x) => x.id).sort(), ['personal', 'wiki']);
    const log = t.lineas.join('\n');
    assert.match(log, /sistema_url_invalida/);
    assert.match(log, /"sistema":"pesca"/);
    assert.equal(log.includes('esto no es'), false);
  } finally { await t.cerrar(); }
});

test('F) correo inexistente, duplicado o vacío también gastan el hash de relleno', async () => {
  let n = 0;
  const t = await crearEntorno({ envolverPersonal: (p) => ({ ...p, async igualarTiempo(c) { n++; return p.igualarTiempo(c); } }) });
  try {
    assert.equal((await t.ingresar('nadie@ecologia.test')).status, 404);
    assert.equal((await t.ingresar('repetido@ecologia.test')).status, 409);
    assert.equal((await t.ingresar('')).status, 400);
    assert.equal(n, 3);
  } finally { await t.cerrar(); }
});
