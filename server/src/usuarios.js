// Operaciones sobre la tabla `empleados` del adaptador de PRUEBA (sin seeds de demo). Nunca devuelve ni registra hashes.
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { normalizarCorreo } from './correo.js';
import { migrarPersonalPrueba } from './personal/prueba.js';

/** Error de uso/validación: su mensaje es seguro de mostrar. */
export class ErrorUso extends Error {}

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CLAVE_MIN = 10;

export function generarClave() {
  return randomBytes(18).toString('base64url'); // 24 caracteres, ~144 bits
}

export async function crearUsuario(pool, { email, nombre, apellido, clave }) {
  const correo = normalizarCorreo(email);
  if (!RE_CORREO.test(correo) || correo.length > 254) throw new ErrorUso('correo inválido');
  const n = String(nombre ?? '').trim();
  const a = String(apellido ?? '').trim();
  if (!n || !a) throw new ErrorUso('nombre y apellido son obligatorios');
  if (n.length > 100 || a.length > 100) throw new ErrorUso('nombre o apellido demasiado largo');
  if (typeof clave !== 'string' || clave.length < CLAVE_MIN) throw new ErrorUso(`la clave debe tener al menos ${CLAVE_MIN} caracteres`);
  if (clave.length > 1024) throw new ErrorUso('la clave es demasiado larga');
  const hash = await argon2.hash(clave, { type: argon2.argon2id });
  const id = `emp-${randomBytes(6).toString('hex')}`;
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    await cli.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`usuario:${correo}`]);
    const dup = await cli.query('SELECT 1 FROM empleados WHERE lower(trim(email)) = $1 LIMIT 1', [correo]);
    if (dup.rowCount) throw new ErrorUso('ya existe un usuario con ese correo');
    await cli.query(
      'INSERT INTO empleados (id,email,nombre,apellido,activo,clave_hash) VALUES ($1,$2,$3,$4,true,$5)',
      [id, correo, n, a, hash]);
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cli.release();
  }
  return { id, email: correo, nombre: n, apellido: a, activo: true };
}

export async function listarUsuarios(pool) {
  const { rows } = await pool.query('SELECT id, email, nombre, apellido, activo FROM empleados ORDER BY email, id');
  return rows;
}

/** Devuelve cuántos usuarios se desactivaron (0 = no existía). */
export async function desactivarUsuario(pool, email) {
  const correo = normalizarCorreo(email);
  if (!correo) throw new ErrorUso('falta --email');
  const r = await pool.query('UPDATE empleados SET activo = false WHERE lower(trim(email)) = $1', [correo]);
  if (!r.rowCount) throw new ErrorUso('no existe un usuario con ese correo');
  return r.rowCount;
}

export { migrarPersonalPrueba };
