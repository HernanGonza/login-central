// Carga/listado de `sso_sistemas` desde JSON. Upsert por id; todo o nada.
import { ErrorUso } from './usuarios.js';

const RE_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function validarUrl(valor, campo, id, produccion) {
  let u;
  try { u = new URL(valor); } catch { throw new ErrorUso(`sistema "${id}": ${campo} no es una URL válida`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ErrorUso(`sistema "${id}": ${campo} debe ser http(s)`);
  if (produccion && u.protocol !== 'https:') throw new ErrorUso(`sistema "${id}": ${campo} debe ser https en producción`);
  if (u.username || u.password) throw new ErrorUso(`sistema "${id}": ${campo} no puede llevar credenciales`);
  return valor;
}

/** Valida y normaliza la lista. Lanza ErrorUso ante el primer problema. */
export function validarSistemas(lista, { produccion }) {
  if (!Array.isArray(lista) || !lista.length) throw new ErrorUso('el JSON debe ser un arreglo no vacío de sistemas');
  const vistos = new Set();
  return lista.map((s, i) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new ErrorUso(`elemento ${i}: debe ser un objeto`);
    const id = s.id;
    if (typeof id !== 'string' || !RE_ID.test(id)) throw new ErrorUso(`elemento ${i}: id inválido (minúsculas, números, - y _; máx. 40)`);
    if (vistos.has(id)) throw new ErrorUso(`id repetido en el archivo: "${id}"`);
    vistos.add(id);
    if (typeof s.nombre !== 'string' || !s.nombre.trim()) throw new ErrorUso(`sistema "${id}": nombre obligatorio`);
    for (const k of ['descripcion', 'icono']) {
      if (s[k] !== undefined && typeof s[k] !== 'string') throw new ErrorUso(`sistema "${id}": ${k} debe ser texto`);
    }
    for (const k of ['siempre_visible', 'activo']) {
      if (s[k] !== undefined && typeof s[k] !== 'boolean') throw new ErrorUso(`sistema "${id}": ${k} debe ser booleano`);
    }
    return {
      id,
      nombre: s.nombre.trim().slice(0, 100),
      descripcion: (s.descripcion ?? '').slice(0, 500),
      icono: (s.icono ?? '').slice(0, 40),
      url_login: validarUrl(s.url_login, 'url_login', id, produccion),
      url_acceso: validarUrl(s.url_acceso, 'url_acceso', id, produccion),
      siempre_visible: s.siempre_visible ?? false,
      activo: s.activo ?? true,
    };
  });
}

export async function cargarSistemas(pool, lista, { produccion }) {
  const filas = validarSistemas(lista, { produccion });
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    for (const f of filas) {
      await cli.query(
        `INSERT INTO sso_sistemas (id,nombre,descripcion,icono,url_login,url_acceso,siempre_visible,activo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET nombre=EXCLUDED.nombre, descripcion=EXCLUDED.descripcion, icono=EXCLUDED.icono,
           url_login=EXCLUDED.url_login, url_acceso=EXCLUDED.url_acceso,
           siempre_visible=EXCLUDED.siempre_visible, activo=EXCLUDED.activo`,
        [f.id, f.nombre, f.descripcion, f.icono, f.url_login, f.url_acceso, f.siempre_visible, f.activo]);
    }
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cli.release();
  }
  return filas.map((f) => f.id);
}

export async function listarSistemas(pool) {
  const { rows } = await pool.query(
    'SELECT id, nombre, url_login, url_acceso, siempre_visible, activo FROM sso_sistemas ORDER BY id');
  return rows;
}
