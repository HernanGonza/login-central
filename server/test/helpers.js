import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { solveChallenge } from 'altcha-lib/v1';
import { leerConfig } from '../src/config.js';
import { migrar, sembrarSistemas } from '../src/db.js';
import { cargarClaves } from '../src/claves.js';
import { crearPersonalPrueba, migrarPersonalPrueba, sembrarPersonalPrueba } from '../src/personal/prueba.js';
import { crearApp } from '../src/app.js';
import { crearLog } from '../src/log.js';

// Parámetros válidos también en producción (clave HMAC >= 32, topes dentro de rango).
export const HMAC_LARGA = 'hmac-de-prueba-0123456789-abcdefghij-XYZ';
export const ENV_PROD = {
  NODE_ENV: 'production', PORTAL_PERMITIR_ADAPTADOR_PRUEBA: '1', ALTCHA_HMAC_KEY: HMAC_LARGA, ALTCHA_MAXNUMBER: '10000',
  ALTCHA_LIMITE_IP_MIN: '10000', LIMITE_ENTRAR_MIN: '10000', LIMITE_FORZAR_MIN: '10000',
};

export const CLAVE = 'clave-de-prueba';
export const ISSUER = 'https://portal.prueba.invalid';
export const PORTAL = 'https://portal.prueba.invalid';

// Una base nueva por entorno de prueba (aislamiento total).
export async function crearEntorno({ env = {}, fetchImpl, ahoraMs, envolverPersonal } = {}) {
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const nombre = `t_${randomBytes(6).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${nombre}`);
  const origen = process.env.TEST_DATABASE_URL;
  let base;
  if (origen.includes('host=')) base = origen.replace('/postgres?', `/${nombre}?`);
  else { const u = new URL(origen); u.pathname = `/${nombre}`; base = u.toString(); }
  const pool = new pg.Pool({ connectionString: base, max: 5 });
  pool.on('error', () => {});
  await migrar(pool);
  await sembrarSistemas(pool, {
    SISTEMA_PERSONAL_URL_LOGIN: 'http://personal.invalid/sso/login',
    SISTEMA_PERSONAL_URL_ACCESO: 'http://personal.invalid/sso/acceso',
    SISTEMA_WIKI_URL_LOGIN: 'http://wiki.invalid/sso/login',
    SISTEMA_WIKI_URL_ACCESO: 'http://wiki.invalid/sso/acceso',
    SISTEMA_PESCA_URL_LOGIN: 'http://pesca.invalid/sso/login',
    SISTEMA_PESCA_URL_ACCESO: 'http://pesca.invalid/sso/acceso',
  });
  await migrarPersonalPrueba(pool);
  await sembrarPersonalPrueba(pool, CLAVE);

  const config = leerConfig({
    DATABASE_URL: base, SSO_ISSUER: ISSUER, PORTAL_URL: PORTAL,
    PERSONAL_REGISTRO_URL: 'https://personal.invalid/registro',
    PERSONAL_RECUPERO_URL: 'https://personal.invalid/recupero',
    NODE_ENV: 'development', ALTCHA_HMAC_KEY: 'hmac-de-prueba',
    // Pruebas rápidas y sin topes de pedidos (cada prueba que los necesita los fija).
    ALTCHA_MAXNUMBER: '3000', ALTCHA_LIMITE_IP_MIN: '100000', LIMITE_ENTRAR_MIN: '100000', LIMITE_FORZAR_MIN: '100000',
    ...env,
  });
  const claves = await cargarClaves(config, { permitirEfimera: true });
  const lineas = [];
  const log = crearLog((l) => lineas.push(l));
  const personal = envolverPersonal ? envolverPersonal(crearPersonalPrueba(pool)) : crearPersonalPrueba(pool);
  const app = crearApp({ config, pool, personal, claves, log, fetchImpl, ahoraMs });
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const url = `http://127.0.0.1:${servidor.address().port}`;

  const api = {
    url, pool, claves, config, lineas, log,
    async cerrar() {
      await new Promise((ok) => servidor.close(ok));
      servidor.closeAllConnections?.();
      await pool.end();
      await admin.query(`DROP DATABASE ${nombre} WITH (FORCE)`);
      await admin.end();
    },
    async solucion() {
      const ch = await (await fetch(`${url}/api/altcha`)).json();
      const { promise } = solveChallenge(ch.challenge, ch.salt, ch.algorithm, ch.maxnumber);
      const sol = await promise;
      return Buffer.from(JSON.stringify({
        algorithm: ch.algorithm, challenge: ch.challenge, number: sol.number, salt: ch.salt, signature: ch.signature,
      })).toString('base64');
    },
    async post(ruta, cuerpo, cookie) {
      const r = await fetch(`${url}${ruta}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(cuerpo ?? {}),
      });
      return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) };
    },
    async get(ruta, cookie) {
      const r = await fetch(`${url}${ruta}`, { headers: cookie ? { Cookie: cookie } : {} });
      return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) };
    },
    async ingresar(email, clave = CLAVE, extra = {}) {
      return api.post('/api/ingreso', { email, clave, altcha: await api.solucion(), ...extra });
    },
    /** Inicia sesión y devuelve el valor de la cookie lista para reenviar. */
    async sesion(email = 'ana.perez@ecologia.test') {
      const r = await api.ingresar(email);
      if (r.status !== 200) throw new Error(`ingreso falló: ${r.status}`);
      return r.headers.getSetCookie()[0].split(';')[0];
    },
  };
  return api;
}
