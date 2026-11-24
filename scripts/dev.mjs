// npm run dev: levanta TODO el entorno local de PRUEBA (nada real, nada de producción):
//  - Postgres propio en .dev/pg (puerto 54329, solo localhost), con migración y datos de prueba
//  - portal (server) :3000  ·  web (Vite) :5173
//  - tres sistemas falsos: personal :4101, wiki :4102, pesca :4103
// Ctrl+C lo apaga todo.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const dev = join(raiz, '.dev');
const pgDir = join(dev, 'pg');
// Puertos configurables para convivir con otros proyectos (la Wiki real usa 3000/5173/54329). Ver `npm run dev:wiki`.
const PG_PUERTO = Number(process.env.PG_PUERTO || 54329);
const API_PUERTO = process.env.PORTAL_PUERTO_API || '3000';
const WEB_PUERTO = process.env.PORTAL_PUERTO_WEB || '5173';
const WIKI_REAL = (process.env.WIKI_REAL_URL || '').replace(/\/$/, '');   // ej. http://localhost:5173 (Wiki real en dev)
const DB = `postgres://dev@127.0.0.1:${PG_PUERTO}/portal`;
mkdirSync(dev, { recursive: true });

function pgBin() {
  const r = spawnSync('which', ['initdb']);
  if (r.status === 0) return dirname(r.stdout.toString().trim());
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) for (const v of readdirSync(base).sort().reverse()) if (existsSync(join(base, v, 'bin', 'initdb'))) return join(base, v, 'bin');
  throw new Error('No encuentro initdb (PostgreSQL). Definí PATH.');
}
const bin = pgBin();
const pg = (c, a, o = {}) => spawnSync(join(bin, c), a, { encoding: 'utf8', ...o });

// 1) Postgres de desarrollo
if (!existsSync(join(pgDir, 'PG_VERSION'))) {
  const r = pg('initdb', ['-D', pgDir, '-A', 'trust', '-U', 'dev', '--no-sync']);
  if (r.status !== 0) throw new Error('initdb falló: ' + r.stderr);
}
const estado = pg('pg_ctl', ['-D', pgDir, 'status']);
let pgPropio = false;
if (estado.status !== 0) {
  const r = pg('pg_ctl', ['-D', pgDir, '-w', '-l', join(dev, 'pg.log'), '-o', `-c listen_addresses=127.0.0.1 -p ${PG_PUERTO} -k ${dev} -c fsync=off`, 'start']);
  if (r.status !== 0) throw new Error('pg_ctl start falló: ' + r.stderr + r.stdout);
  pgPropio = true;
}
const existe = pg('psql', ['-h', '127.0.0.1', '-p', String(PG_PUERTO), '-U', 'dev', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname='portal'"]);
if (!existe.stdout.trim()) pg('createdb', ['-h', '127.0.0.1', '-p', String(PG_PUERTO), '-U', 'dev', 'portal']);

// 2) Clave de firma de DESARROLLO (persistente, ignorada por git). Nunca una clave real.
const clavePath = join(dev, 'clave-dev.pem');
if (!existsSync(clavePath)) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  writeFileSync(clavePath, privateKey, { mode: 0o600 });
}

const PORTAL = `http://localhost:${API_PUERTO}`;
const PORTAL_WEB = `http://localhost:${WEB_PUERTO}`;
const envPortal = {
  ...process.env, NODE_ENV: 'development', PORT: API_PUERTO, DATABASE_URL: DB,
  SSO_ISSUER: PORTAL, PORTAL_URL: PORTAL_WEB, SSO_PRIVATE_KEY_PATH: clavePath,
  ALTCHA_HMAC_KEY: 'clave-hmac-DEV-no-usar-en-produccion', COOKIE_SECURE: 'false',
  PERSONAL_REGISTRO_URL: 'https://personal.invalid/registro', PERSONAL_RECUPERO_URL: 'https://personal.invalid/recupero',
  LIMITE_POR_PAR: '50', LIMITE_POR_CORREO: '100', LIMITE_POR_IP: '200',
};

// 3) Migración + datos de prueba
const seed = spawnSync(process.execPath, ['src/seed.js'], { cwd: join(raiz, 'server'), env: envPortal, encoding: 'utf8' });
if (seed.status !== 0) { console.error(seed.stderr || seed.stdout); process.exit(1); }

const extra = spawnSync(process.execPath, [join(raiz, 'scripts', 'dev-usuarios.mjs')], { env: envPortal, encoding: 'utf8' });
if (extra.status !== 0) { console.error(extra.stderr || extra.stdout); process.exit(1); }
if (extra.stdout) process.stdout.write(extra.stdout);
// correos extra por sistema falso (desde .dev/usuarios-extra.json)
let extras = [];
try { extras = JSON.parse(readFileSync(join(dev, 'usuarios-extra.json'), 'utf8')); } catch { /* sin extras */ }
const sumar = (id, rol) => extras.filter((u) => (u.sistemas || []).includes(id)).map((u) => `,${u.email.toLowerCase()}:${rol}`).join('');

// Wiki REAL: apunta la fila 'wiki' del portal a la Wiki local (la semilla no pisa filas existentes).
if (WIKI_REAL) {
  const r = pg('psql', ['-h', '127.0.0.1', '-p', String(PG_PUERTO), '-U', 'dev', '-d', 'portal', '-v', 'ON_ERROR_STOP=1', '-c',
    `UPDATE sso_sistemas SET url_login='${WIKI_REAL}/sso/login', url_acceso='${WIKI_REAL}/sso/acceso' WHERE id='wiki'`]);
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  console.log(`[dev] sistema "wiki" del portal -> Wiki real en ${WIKI_REAL}`);
}

// 4) Procesos
const hijos = [];
function lanzar(nombre, cmd, args, cwd, env) {
  const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const pref = `[${nombre}]`.padEnd(12);
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => console.log(pref, l)));
  p.on('exit', (c) => console.log(pref, 'terminó', c));
  hijos.push(p);
}
const jwks = `${PORTAL}/.well-known/jwks.json`;
const falso = (id, puerto, usuarios) => lanzar(`sf-${id}`, process.execPath, ['src/servidor.mjs'], join(raiz, 'sistema-falso'), {
  ...process.env, PORT: String(puerto), SSO_ISSUER: PORTAL, SSO_AUDIENCE: id, SSO_JWKS_URL: jwks,
  PORTAL_URL: PORTAL_WEB, COOKIE_SECURE: 'false', SF_CONTROL: '1', SF_USUARIOS: usuarios,
});
lanzar('portal', process.execPath, ['src/index.js'], join(raiz, 'server'), envPortal);
falso('personal', 4101, 'ana.perez@ecologia.test:admin,luis.gomez@ecologia.test:usuario,repetido@ecologia.test:usuario' + sumar('personal', 'admin'));
if (!WIKI_REAL) falso('wiki', 4102, 'ana.perez@ecologia.test:admin,luis.gomez@ecologia.test:lector' + sumar('wiki', 'admin'));
falso('pesca', 4103, 'ana.perez@ecologia.test:inspector' + sumar('pesca', 'inspector'));   // luis NO está: su tarjeta de Pesca no aparece
lanzar('web', process.execPath, [join(raiz, 'node_modules/vite/bin/vite.js'), '--port', WEB_PUERTO, '--strictPort', '--host', 'localhost'], join(raiz, 'web'), { ...process.env, API_URL: PORTAL });

console.log(`
  Portal:   ${PORTAL_WEB}
  Usuarios de prueba (clave: clave-de-prueba):
    ana.perez@ecologia.test   -> Personal, Wiki (admin) y Pesca
    luis.gomez@ecologia.test  -> Personal y Wiki (lector); SIN tarjeta de Pesca
    repetido@ecologia.test    -> muestra el aviso de correo duplicado
    nadie@ecologia.test       -> "No encontramos tu correo"
  Apagar un sistema para ver la tarjeta gris:  curl -X POST 'localhost:4103/_control?modo=caido'   (normal para volver)
`);

let saliendo = false;
function salir() {
  if (saliendo) return; saliendo = true;
  hijos.forEach((h) => h.kill('SIGTERM'));
  if (pgPropio) pg('pg_ctl', ['-D', pgDir, '-m', 'fast', 'stop']);
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', salir); process.on('SIGTERM', salir);
