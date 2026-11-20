// Sesión del portal: cookie opaca (HttpOnly, SameSite=Lax, 8 h); en la base solo se guarda su sha256.
import { randomBytes, createHash } from 'node:crypto';

export const COOKIE = 'sso_portal';
const hash = (v) => createHash('sha256').update(v).digest('hex');

export function crearSesiones({ pool, config, ahora = () => new Date() }) {
  const opcionesCookie = () => ({
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: config.basePath ?? '/',
    maxAge: config.sesionSegundos * 1000,
  });
  return {
    opcionesCookie,
    async crear(res, empleado) {
      const id = randomBytes(32).toString('base64url');
      const expira = new Date(ahora().getTime() + config.sesionSegundos * 1000);
      await pool.query(
        `INSERT INTO sso_sesiones (id_hash, empleado_id, email, nombre, creada, expira) VALUES ($1,$2,$3,$4,$5,$6)`,
        [hash(id), empleado.id, empleado.email, `${empleado.nombre} ${empleado.apellido}`.trim(), ahora(), expira]);
      res.cookie(COOKIE, id, opcionesCookie());
    },
    async leer(req) {
      const id = req.cookies?.[COOKIE];
      if (typeof id !== 'string' || id.length < 20 || id.length > 200) return null;
      const { rows } = await pool.query(
        'SELECT * FROM sso_sesiones WHERE id_hash = $1 AND expira > $2', [hash(id), ahora()]);
      return rows[0] ? { ...rows[0], idHash: rows[0].id_hash } : null;
    },
    async destruir(req, res) {
      const id = req.cookies?.[COOKIE];
      if (typeof id === 'string') await pool.query('DELETE FROM sso_sesiones WHERE id_hash = $1', [hash(id)]);
      const { maxAge, ...resto } = opcionesCookie();
      res.clearCookie(COOKIE, resto);
    },
    async guardarCache(idHash, cache) {
      await pool.query('UPDATE sso_sesiones SET cache = $2 WHERE id_hash = $1', [idHash, cache]);
    },
    /** Actualiza una entrada del caché de forma atómica (consultas paralelas no se pisan). */
    async ponerEnCache(idHash, sistemaId, entrada) {
      await pool.query(
        `UPDATE sso_sesiones SET cache = jsonb_set(cache, ARRAY[$2]::text[], $3::jsonb, true) WHERE id_hash = $1`,
        [idHash, sistemaId, JSON.stringify(entrada)]);
    },
  };
}
