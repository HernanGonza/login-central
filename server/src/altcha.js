// ALTCHA auto-alojado (altcha-lib v1: challenge + solución firmada con HMAC). Sin terceros.
import { createChallenge, verifySolution, extractParams } from 'altcha-lib/v1';
import { randomBytes } from 'node:crypto';

export function crearAltcha({ pool, hmacKey, maxnumber = 1_000_000, vidaSeg = 300 }) {
  // El config exige la clave fuera de desarrollo; la efímera solo queda para NODE_ENV=development.
  const clave = hmacKey || randomBytes(32).toString('hex'); // efímera si no se configura (se invalida al reiniciar)
  return {
    async desafio() {
      return createChallenge({ hmacKey: clave, maxnumber, expires: new Date(Date.now() + vidaSeg * 1000) });
    },
    /** Verifica y consume la solución (un solo uso). */
    async verificar(payload) {
      if (typeof payload !== 'string' || !payload || payload.length > 4096) return false;
      let ok = false;
      try {
        ok = await verifySolution(payload, clave, true);
      } catch {
        return false;
      }
      if (!ok) return false;
      let firma;
      try {
        firma = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).signature;
      } catch {
        return false;
      }
      await pool.query('DELETE FROM altcha_usados WHERE expira < now()');
      const r = await pool.query(
        `INSERT INTO altcha_usados (firma, expira) VALUES ($1, now() + ($2 || ' seconds')::interval)
         ON CONFLICT DO NOTHING`, [firma, String(vidaSeg)]);
      return r.rowCount === 1; // 0 = ya usada (repetición)
    },
  };
}
export { extractParams };
