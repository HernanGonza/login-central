import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export function crearPool(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on('error', () => {}); // un cliente ocioso cortado por el servidor no debe tumbar el proceso
  return pool;
}

const dirMig = fileURLToPath(new URL('../migrations/', import.meta.url));

// Migraciones idempotentes (CREATE ... IF NOT EXISTS), en orden alfabético.
export async function migrar(pool) {
  for (const f of readdirSync(dirMig).filter((x) => x.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(join(dirMig, f), 'utf8'));
  }
}

// Semillas de sso_sistemas. URLs desde el entorno (valores de prueba locales si faltan).
export async function sembrarSistemas(pool, env = process.env) {
  const u = (k, d) => env[k] || d;
  const filas = [
    ['personal', 'Personal', 'Legajo, licencias y datos del empleado.', 'users',
      u('SISTEMA_PERSONAL_URL_LOGIN', 'http://localhost:4101/sso/login'),
      u('SISTEMA_PERSONAL_URL_ACCESO', 'http://localhost:4101/sso/acceso'), true],
    ['wiki', 'Wiki', 'Documentación y procedimientos internos.', 'book',
      u('SISTEMA_WIKI_URL_LOGIN', 'http://localhost:4102/sso/login'),
      u('SISTEMA_WIKI_URL_ACCESO', 'http://localhost:4102/sso/acceso'), true],
    ['pesca', 'Pesca', 'Permisos y registros de pesca.', 'fish',
      u('SISTEMA_PESCA_URL_LOGIN', 'http://localhost:4103/sso/login'),
      u('SISTEMA_PESCA_URL_ACCESO', 'http://localhost:4103/sso/acceso'), false],
  ];
  for (const f of filas) {
    if (!/^https?:\/\//i.test(f[4]) || !/^https?:\/\//i.test(f[5])) {
      throw new Error(`sembrarSistemas: url_login/url_acceso de "${f[0]}" deben ser http(s)`);
    }
    new URL(f[4]); new URL(f[5]);
    await pool.query(
      `INSERT INTO sso_sistemas (id,nombre,descripcion,icono,url_login,url_acceso,siempre_visible,activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT (id) DO NOTHING`, f);
  }
}
