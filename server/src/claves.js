// Par de claves RS256. La privada vive fuera del repo (SSO_PRIVATE_KEY_PATH o SSO_PRIVATE_KEY).
import { readFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { exportJWK, calculateJwkThumbprint } from 'jose';

async function desdePrivada(privada, kidFijo) {
  const publica = createPublicKey(privada);
  const jwk = await exportJWK(publica);
  const kid = kidFijo || (await calculateJwkThumbprint(jwk));
  return {
    kid,
    privada,
    jwks: { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] },
  };
}

export async function cargarClaves(config, { permitirEfimera = false } = {}) {
  let pem = config.privateKey;
  if (!pem && config.privateKeyPath) pem = readFileSync(config.privateKeyPath, 'utf8');
  if (pem) {
    pem = pem.replace(/\\n/g, '\n');
    const privada = createPrivateKey(pem);
    if (privada.asymmetricKeyType !== 'rsa') throw new Error('La clave del pase debe ser RSA (RS256)');
    return desdePrivada(privada, config.kid);
  }
  if (!permitirEfimera) throw new Error('Falta SSO_PRIVATE_KEY_PATH o SSO_PRIVATE_KEY');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return desdePrivada(privateKey, config.kid);
}
