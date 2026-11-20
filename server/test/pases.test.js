import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRemoteJWKSet, createLocalJWKSet, jwtVerify, decodeProtectedHeader, errors } from 'jose';
import { crearEntorno, ISSUER } from './helpers.js';
import { cargarClaves } from '../src/claves.js';
import { crearEmisor } from '../src/pases.js';

let t;
before(async () => { t = await crearEntorno(); });
after(async () => { await t.cerrar(); });

const ana = { id: 'emp-1001', email: 'Ana.Perez@Ecologia.test', nombre: 'Ana', apellido: 'Pérez' };

test('JWKS publicado: solo parte pública, con kid y alg RS256', async () => {
  const r = await t.get('/.well-known/jwks.json');
  assert.equal(r.status, 200);
  const [k] = r.json.keys;
  assert.equal(r.json.keys.length, 1);
  assert.equal(k.kty, 'RSA');
  assert.equal(k.alg, 'RS256');
  assert.ok(k.kid);
  for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi']) assert.equal(k[priv], undefined);
});

test('un pase emitido se verifica con jose usando solo el JWKS (HTTP)', async () => {
  const emisor = crearEmisor({ claves: t.claves, issuer: ISSUER, pool: t.pool });
  const pase = await emisor.emitir({ empleado: ana, aud: 'wiki', use: 'login' });
  const jwks = createRemoteJWKSet(new URL(`${t.url}/.well-known/jwks.json`));
  const { payload, protectedHeader } = await jwtVerify(pase, jwks, {
    issuer: ISSUER, audience: 'wiki', algorithms: ['RS256'],
  });
  assert.equal(protectedHeader.alg, 'RS256');
  assert.equal(protectedHeader.kid, t.claves.kid);
  assert.equal(payload.sub, 'emp-1001');
  assert.equal(payload.email, 'ana.perez@ecologia.test');
  assert.equal(payload.name, 'Ana Pérez');
  assert.equal(payload.use, 'login');
  assert.equal(payload.exp, payload.iat + 60);
  assert.ok(payload.jti);
  assert.equal(payload.roles, undefined);
  assert.equal(payload.rol, undefined);
});

test('aud ajeno, firma ajena y pase vencido fallan', async () => {
  const emisor = crearEmisor({ claves: t.claves, issuer: ISSUER });
  const jwks = createLocalJWKSet((await t.get('/.well-known/jwks.json')).json);
  const pase = await emisor.emitir({ empleado: ana, aud: 'wiki', use: 'acceso' });
  await assert.rejects(jwtVerify(pase, jwks, { issuer: ISSUER, audience: 'pesca' }), errors.JWTClaimValidationFailed);
  const ajena = await cargarClaves({}, { permitirEfimera: true });
  const otro = crearEmisor({ claves: { ...ajena, kid: t.claves.kid }, issuer: ISSUER });
  const falso = await otro.emitir({ empleado: ana, aud: 'wiki', use: 'acceso' });
  await assert.rejects(jwtVerify(falso, jwks, { issuer: ISSUER, audience: 'wiki' }), errors.JWSSignatureVerificationFailed);
  const viejo = crearEmisor({ claves: t.claves, issuer: ISSUER, ahora: () => Math.floor(Date.now() / 1000) - 3600 });
  const vencido = await viejo.emitir({ empleado: ana, aud: 'wiki', use: 'acceso' });
  await assert.rejects(jwtVerify(vencido, jwks, { issuer: ISSUER, audience: 'wiki' }), errors.JWTExpired);
});

test('jti únicos y los pases login quedan en auditoría (sin el pase)', async () => {
  const emisor = crearEmisor({ claves: t.claves, issuer: ISSUER, pool: t.pool });
  const a = await emisor.emitir({ empleado: ana, aud: 'wiki', use: 'login' });
  const b = await emisor.emitir({ empleado: ana, aud: 'wiki', use: 'login' });
  const ja = JSON.parse(Buffer.from(a.split('.')[1], 'base64url')).jti;
  const jb = JSON.parse(Buffer.from(b.split('.')[1], 'base64url')).jti;
  assert.notEqual(ja, jb);
  const { rows } = await t.pool.query('SELECT * FROM jti_usados WHERE jti = ANY($1)', [[ja, jb]]);
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['aud', 'emitido', 'jti', 'sub']);
});

test('clave de vectores PRUEBA: el kid y el JWKS coinciden con los vectores del contrato', async () => {
  const dir = fileURLToPath(new URL('../../docs/sso/vectores/', import.meta.url));
  const jwksVec = JSON.parse(readFileSync(`${dir}jwks.PRUEBA.json`, 'utf8'));
  const claves = await cargarClaves({
    privateKey: readFileSync(`${dir}clave-privada.PRUEBA.pem`, 'utf8'), kid: 'PRUEBA-1',
  });
  assert.equal(claves.jwks.keys[0].n, jwksVec.keys[0].n);
  assert.equal(claves.jwks.keys[0].kid, 'PRUEBA-1');
  const pase = await crearEmisor({ claves, issuer: ISSUER }).emitir({ empleado: ana, aud: 'x', use: 'acceso' });
  assert.equal(decodeProtectedHeader(pase).kid, 'PRUEBA-1');
  await jwtVerify(pase, createLocalJWKSet(jwksVec), { issuer: ISSUER, audience: 'x' });
});

test('cargarClaves exige clave configurada fuera de modo efímero y rechaza claves no RSA', async () => {
  await assert.rejects(cargarClaves({}), /Falta SSO_PRIVATE_KEY/);
  const { generateKeyPairSync } = await import('node:crypto');
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  await assert.rejects(cargarClaves({ privateKey: ec }), /RSA/);
});
