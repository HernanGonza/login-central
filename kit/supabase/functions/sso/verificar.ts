// Verificación del pase SSO (CONTRATO.md sección 2). Orden fijo; el primer fallo corta.
// Los motivos se devuelven al código llamador; NUNCA al cliente HTTP.
import { compactVerify, createRemoteJWKSet, decodeProtectedHeader } from "jose";
import type { CompactVerifyGetKey } from "jose";

export type Motivo = "formato" | "alg" | "firma" | "iss" | "aud" | "exp" | "use" | "jti";
export type Use = "acceso" | "login";

export interface Claims {
  iss: string; aud: string; sub: string; email: string; name?: string;
  use: string; iat: number; exp: number; jti?: string;
}

export type Resultado = { ok: true; claims: Claims } | { ok: false; motivo: Motivo };

export interface OpcionesVerificar {
  use: Use;
  iss: string;
  aud: string;
  getKey: CompactVerifyGetKey;
  /** Reloj en segundos (inyectable para pruebas). */
  ahora: () => number;
  /** Marca el jti como usado; devuelve false si ya estaba usado. Solo se llama con use=login. */
  marcarJti: (jti: string, exp: number) => Promise<boolean>;
  tolerancia?: number;
}

/** JWKS remoto con caché de 1 h; ante kid desconocido jose refresca (con enfriamiento). */
export function validarJwksUrl(jwksUrl: string, permitirHttp = false): URL {
  let u: URL;
  try {
    u = new URL(jwksUrl);
  } catch {
    throw new Error("SSO_JWKS_URL invalida");
  }
  if (u.protocol === "https:") return u;
  if (u.protocol === "http:" && (permitirHttp || ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))) return u;
  throw new Error("SSO_JWKS_URL debe ser https:// (http solo en localhost o con permitirHttp)");
}

/** Exige https:// (http solo localhost/127.0.0.1/::1 o permitirHttp explícito, solo desarrollo). */
export function crearGetKeyRemoto(jwksUrl: string, permitirHttp = false): CompactVerifyGetKey {
  return createRemoteJWKSet(validarJwksUrl(jwksUrl, permitirHttp), {
    cacheMaxAge: 60 * 60 * 1000,
    cooldownDuration: 5_000,
    timeoutDuration: 3_000,
  }) as unknown as CompactVerifyGetKey;
}

export async function verificarPase(token: string, o: OpcionesVerificar): Promise<Resultado> {
  const falla = (motivo: Motivo): Resultado => ({ ok: false, motivo });
  const tol = o.tolerancia ?? 60;

  // 1. Formato y alg
  if (typeof token !== "string" || token.length > 8192 || token.split(".").length !== 3) return falla("formato");
  let alg: unknown;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return falla("formato");
  }
  if (alg !== "RS256") return falla(typeof alg === "string" ? "alg" : "formato");

  // 2. Firma
  let payload: Uint8Array;
  try {
    ({ payload } = await compactVerify(token, o.getKey, { algorithms: ["RS256"] }));
  } catch {
    return falla("firma");
  }
  let claims: Claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(payload));
    if (claims === null || typeof claims !== "object") return falla("formato");
  } catch {
    return falla("formato");
  }

  // 3. iss  4. aud  5. exp  6. use
  if (claims.iss !== o.iss) return falla("iss");
  if (typeof claims.aud !== "string" || claims.aud !== o.aud) return falla("aud");
  const t = o.ahora();
  if (!Number.isFinite(claims.exp) || t > claims.exp + tol) return falla("exp");
  if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > t + tol) return falla("exp");
  if (claims.exp - claims.iat > 60 + tol) return falla("exp"); // vida maxima 60 s + tolerancia de reloj
  if (claims.use !== o.use) return falla("use");

  // 7. jti (solo login)
  if (o.use === "login") {
    if (typeof claims.jti !== "string" || !claims.jti) return falla("jti");
    if (!(await o.marcarJti(claims.jti, claims.exp))) return falla("jti");
  }
  if (typeof claims.email !== "string" || !claims.email) return falla("formato");
  return { ok: true, claims };
}
