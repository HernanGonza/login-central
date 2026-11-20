// Implementación PRUEBA del adaptador de Personal: Postgres local, tabla `empleados`, hash argon2id.
// Solo lectura desde el portal. La migración y la semilla de abajo son SOLO para desarrollo/pruebas.
import argon2 from 'argon2';

/**
 * @typedef {{id:string,email:string,nombre:string,apellido:string,activo:boolean}} Empleado
 * @typedef {{
 *   buscarPorCorreo(email:string): Promise<Empleado[]>,
 *   verificarClave(empleado:Empleado, clave:string): Promise<boolean>
 * }} PersonalAdapter
 */

// Hash de relleno para igualar tiempos cuando el empleado no existe.
let hashRelleno;

export function crearPersonalPrueba(pool) {
  return {
    /** Crea la tabla `empleados` si no existe (idempotente). */
    migrar: () => migrarPersonalPrueba(pool),
    async buscarPorCorreo(email) {
      const e = String(email ?? '').trim().toLowerCase();
      if (!e) return [];
      const { rows } = await pool.query(
        `SELECT id, lower(trim(email)) AS email, nombre, apellido, activo
           FROM empleados WHERE lower(trim(email)) = $1 ORDER BY id`, [e]);
      return rows;
    },

    /** Gasta el mismo costo de hash que una verificación real (correo inexistente/duplicado/vacío). */
    async igualarTiempo(clave) {
      hashRelleno ??= await argon2.hash('relleno-sin-significado');
      await argon2.verify(hashRelleno, typeof clave === 'string' && clave ? clave : 'x').catch(() => false);
    },
    async verificarClave(empleado, clave) {
      if (typeof clave !== 'string' || !clave) return false;
      const { rows } = await pool.query('SELECT clave_hash FROM empleados WHERE id = $1', [empleado?.id]);
      if (!rows.length) {
        hashRelleno ??= await argon2.hash('relleno-sin-significado');
        await argon2.verify(hashRelleno, clave).catch(() => false);
        return false;
      }
      try {
        return await argon2.verify(rows[0].clave_hash, clave);
      } catch {
        return false;
      }
    },
  };
}

export async function migrarPersonalPrueba(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS empleados (
      id text PRIMARY KEY,
      email text NOT NULL,            -- sin UNIQUE a propósito: Personal real puede tener duplicados
      nombre text NOT NULL,
      apellido text NOT NULL,
      activo boolean NOT NULL DEFAULT true,
      clave_hash text NOT NULL
    )`);
}

// Datos ficticios. La clave sale del argumento o de SEED_CLAVE_PRUEBA; nunca es una clave real.
export async function sembrarPersonalPrueba(pool, clave = process.env.SEED_CLAVE_PRUEBA || 'clave-de-prueba') {
  const hash = await argon2.hash(clave, { type: argon2.argon2id });
  const filas = [
    ['emp-1001', 'ana.perez@ecologia.test', 'Ana', 'Pérez', true],
    ['emp-1002', 'luis.gomez@ecologia.test', 'Luis', 'Gómez', true],
    ['emp-1003', 'baja@ecologia.test', 'Beto', 'Baja', false],
    ['emp-1004', 'repetido@ecologia.test', 'Rita', 'Repetida', true],
    ['emp-1005', 'repetido@ecologia.test', 'Raúl', 'Repetido', true],
  ];
  for (const f of filas) {
    await pool.query(
      `INSERT INTO empleados (id,email,nombre,apellido,activo,clave_hash)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`, [...f, hash]);
  }
}
