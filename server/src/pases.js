// Emisión de pases RS256. Sin roles. exp = iat + 60 s. jti único.
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';

export const VIDA_PASE_SEG = 60;

export function crearEmisor({ claves, issuer, ahora = () => Math.floor(Date.now() / 1000), pool }) {
  return {
    /** @param {{empleado:object, aud:string, use:'acceso'|'login'}} p */
    async emitir({ empleado, aud, use }) {
      if (use !== 'acceso' && use !== 'login') throw new Error('use inválido');
      if (!aud) throw new Error('aud requerido');
      const iat = ahora();
      const jti = randomUUID();
      const token = await new SignJWT({
        email: String(empleado.email).trim().toLowerCase(),
        name: `${empleado.nombre} ${empleado.apellido}`.trim(),
        use,
      })
        .setProtectedHeader({ alg: 'RS256', kid: claves.kid, typ: 'JWT' })
        .setIssuer(issuer)
        .setAudience(aud)
        .setSubject(String(empleado.id))
        .setIssuedAt(iat)
        .setExpirationTime(iat + VIDA_PASE_SEG)
        .setJti(jti)
        .sign(claves.privada);
      if (use === 'login' && pool) {
        // Solo auditoría (ids, nunca el pase).
        await pool.query('INSERT INTO jti_usados (jti, aud, sub) VALUES ($1,$2,$3)', [jti, aud, String(empleado.id)]);
      }
      return token;
    },
  };
}
