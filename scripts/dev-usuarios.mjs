// Carga empleados EXTRA de prueba desde .dev/usuarios-extra.json (ignorado por git) en la base de Personal de PRUEBA.
// Clave: SEED_CLAVE_PRUEBA o 'clave-de-prueba'. Nunca se usa contra una base real.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const archivo = join(raiz, '.dev', 'usuarios-extra.json');
if (!existsSync(archivo)) process.exit(0);
const req = createRequire(join(raiz, 'server', 'package.json'));
const argon2 = req('argon2');
const { Pool } = req('pg');
const extra = JSON.parse(readFileSync(archivo, 'utf8'));
const hash = await argon2.hash(process.env.SEED_CLAVE_PRUEBA || 'clave-de-prueba', { type: argon2.argon2id });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
for (const u of extra) {
  await pool.query(
    `INSERT INTO empleados (id,email,nombre,apellido,activo,clave_hash)
     VALUES ($1,lower($2),$3,$4,true,$5) ON CONFLICT (id) DO NOTHING`,
    [u.id, u.email, u.nombre, u.apellido, hash]);
}
await pool.end();
console.log(`[dev] ${extra.length} empleado(s) extra de prueba cargados`);
