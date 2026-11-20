// Genera claves y pases SOLO DE PRUEBA, deterministas respecto del reloj fijo AHORA.
// Uso: npm run vectores   (las claves se regeneran; los archivos .pem dicen PRUEBA)
import { generateKeyPair, exportPKCS8, exportJWK, SignJWT } from 'jose';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const AHORA = 1790000000; // reloj fijo: las pruebas deben inyectar AHORA + 10
const ISS = 'https://portal.prueba.invalid';
const AUD = 'sistema-prueba';
const claims = (o = {}) => ({
  email: 'ana.perez@ecologia.test', name: 'Ana Pérez', sub: 'emp-1001',
  use: 'login', ...o,
});

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const ajena = await generateKeyPair('RS256', { extractable: true });

const jwk = { ...(await exportJWK(publicKey)), kid: 'PRUEBA-1', alg: 'RS256', use: 'sig' };
writeFileSync(join(dir, 'jwks.PRUEBA.json'), JSON.stringify({ keys: [jwk] }, null, 2));
writeFileSync(join(dir, 'clave-privada.PRUEBA.pem'), await exportPKCS8(privateKey));

async function firmar(c, { key = privateKey, kid = 'PRUEBA-1', iat = AHORA, exp = AHORA + 60,
  iss = ISS, aud = AUD, jti } = {}) {
  return new SignJWT(c).setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setIssuer(iss).setAudience(aud).setIssuedAt(iat).setExpirationTime(exp)
    .setJti(jti).sign(key);
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

const vectores = {
  _comentario: 'Todo es SOLO DE PRUEBA. Reloj de las pruebas: ahora = AHORA + 10 s. Esperado: verificar() devuelve ok o el motivo.',
  ahora: AHORA + 10, iss: ISS, aud_esperada: AUD, jwks: 'jwks.PRUEBA.json',
  casos: {
    valido_login:   { token: await firmar(claims(), { jti: 'jti-valido-0001' }), use_esperado: 'login', esperado: 'ok' },
    valido_acceso:  { token: await firmar(claims({ use: 'acceso' }), { jti: 'jti-acceso-0001' }), use_esperado: 'acceso', esperado: 'ok' },
    vencido:        { token: await firmar(claims(), { jti: 'jti-venc-0001', iat: AHORA - 3600, exp: AHORA - 3540 }), use_esperado: 'login', esperado: 'exp' },
    dentro_tolerancia: { token: await firmar(claims(), { jti: 'jti-tol-0001', iat: AHORA - 100, exp: AHORA + 10 - 30 }), use_esperado: 'login', esperado: 'ok', nota: 'vencido hace 30 s: la tolerancia es 60 s' },
    iss_ajeno:      { token: await firmar(claims(), { jti: 'jti-iss-0001', iss: 'https://otro.invalid' }), use_esperado: 'login', esperado: 'iss' },
    aud_ajeno:      { token: await firmar(claims(), { jti: 'jti-aud-0001', aud: 'otro-sistema' }), use_esperado: 'login', esperado: 'aud' },
    firma_ajena:    { token: await firmar(claims(), { jti: 'jti-firma-0001', key: ajena.privateKey }), use_esperado: 'login', esperado: 'firma', nota: 'mismo kid PRUEBA-1 pero firmada con otra clave' },
    kid_desconocido:{ token: await firmar(claims(), { jti: 'jti-kid-0001', key: ajena.privateKey, kid: 'PRUEBA-DESCONOCIDO' }), use_esperado: 'login', esperado: 'firma', nota: 'debe provocar un refresco del JWKS y luego fallar' },
    use_cambiado:   { token: await firmar(claims({ use: 'acceso' }), { jti: 'jti-use-0001' }), use_esperado: 'login', esperado: 'use' },
    alg_none:       { token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims(), iss: ISS, aud: AUD, iat: AHORA, exp: AHORA + 60, jti: 'jti-none-0001' })}.`, use_esperado: 'login', esperado: 'alg' },
    hs256:          { token: await new SignJWT(claims()).setProtectedHeader({ alg: 'HS256', kid: 'PRUEBA-1' }).setIssuer(ISS).setAudience(AUD).setIssuedAt(AHORA).setExpirationTime(AHORA + 60).setJti('jti-hs-0001').sign(new TextEncoder().encode('secreto-de-PRUEBA-de-32-bytes-minimo!!')), use_esperado: 'login', esperado: 'alg' },
    jti_repetido:   { token: await firmar(claims(), { jti: 'jti-repetido-0001' }), use_esperado: 'login', esperado: 'ok_la_primera_jti_la_segunda', nota: 'presentarlo DOS veces: la 1ª ok, la 2ª rechazada por jti. Solo aplica a use=login' },
    email_mayusculas: { token: await firmar(claims({ email: 'ANA.Perez@Ecologia.TEST' }), { jti: 'jti-mayus-0001' }), use_esperado: 'login', esperado: 'ok', nota: 'la búsqueda debe normalizar a minúsculas' },
    basura:         { token: 'esto.no.es-un-jwt', use_esperado: 'login', esperado: 'formato' },
  },
};
writeFileSync(join(dir, 'vectores.PRUEBA.json'), JSON.stringify(vectores, null, 2));
console.log('Vectores PRUEBA generados en', dir);
