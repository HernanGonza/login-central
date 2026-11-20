import { isIP } from 'node:net';

const ALIAS_PROXY = new Set(['loopback', 'linklocal', 'uniquelocal']);
const MASCARA_MIN_V4 = 8;
const MASCARA_MIN_V6 = 16;

const LIMITE_MAX = 10_000;          // tope de límites por ventana/minuto: más que esto equivale a no limitar
const MAXNUMBER_MIN = 10_000;       // ALTCHA: por debajo, el desafío se resuelve al instante
const MAXNUMBER_MAX = 10_000_000;   // por encima, el navegador tarda demasiado
const HMAC_MIN = 32;

/**
 * TRUST_PROXY: número de saltos (p. ej. "1") o lista de IPs/CIDR/alias separados por comas.
 * `true` (confiar en cualquier salto) solo se acepta fuera de producción: permite falsear la IP
 * con X-Forwarded-For y esquivar el límite de intentos.
 */
export function leerTrustProxy(valor, produccion) {
  const v = String(valor ?? '').trim();
  if (!v || v === 'false' || v === '0') return false;
  if (v === 'true') {
    if (produccion) throw new Error('TRUST_PROXY=true solo se admite con NODE_ENV=development (producción): usá el número de saltos o una lista de IPs');
    return true;
  }
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n > 10) throw new Error('TRUST_PROXY: número de saltos inválido');
    return n;
  }
  const items = v.split(',').map((x) => x.trim());
  for (const it of items) {
    const [ip, mascara, resto] = it.split('/');
    const familia = isIP(ip);
    const okMascara = mascara === undefined
      || (/^\d{1,3}$/.test(mascara) && Number(mascara) <= (familia === 6 ? 128 : 32));
    if (resto !== undefined || !(ALIAS_PROXY.has(it) || (familia && okMascara))) {
      throw new Error(`TRUST_PROXY: entrada inválida "${it}" (use un número de saltos o IPs/CIDR)`);
    }
    // Un rango enorme (p. ej. 0.0.0.0/0) equivale a confiar en cualquiera y permite falsear la IP.
    if (mascara !== undefined && Number(mascara) < (familia === 6 ? MASCARA_MIN_V6 : MASCARA_MIN_V4)) {
      throw new Error(`TRUST_PROXY: rango demasiado ancho "${it}" (mínimo /${MASCARA_MIN_V4} en IPv4, /${MASCARA_MIN_V6} en IPv6)`);
    }
  }
  return items;
}

/** PORTAL_BASE_PATH: '/' o '/segmento[/segmento]' (sin '..', '//', query ni caracteres raros). Se devuelve sin '/' final. */
export function leerBasePath(valor) {
  const v = String(valor ?? '').trim();
  if (!v || v === '/') return '/';
  if (!/^\/[A-Za-z0-9._~\-]+(\/[A-Za-z0-9._~\-]+)*\/?$/.test(v) || v.split('/').some((x) => x === '.' || x === '..')) {
    throw new Error("PORTAL_BASE_PATH inválido (debe empezar con '/', sin '..', '//' ni caracteres especiales)");
  }
  return v.replace(/\/$/, '');
}

// Toda URL, iss y secreto sale del entorno. Nada de esto va en el código.
export function leerConfig(env = process.env) {
  const req = (k) => {
    if (!env[k]) throw new Error(`Falta la variable de entorno ${k}`);
    return env[k];
  };
  // Entero positivo o error: un NaN haría `n >= NaN` falso siempre y desactivaría el límite.
  // Fuera de desarrollo se aplican además topes [min, max] razonables (valores extremos desactivan la protección).
  const num = (k, d, min = 1, max = Infinity) => {
    if (env[k] === undefined || env[k] === '') return d;
    if (!/^[1-9]\d{0,14}$/.test(String(env[k]).trim())) throw new Error(`${k} debe ser un entero positivo (valor recibido inválido)`);
    const n = Number(env[k]);
    if (!desarrollo && (n < min || n > max)) throw new Error(`${k} debe estar entre ${min} y ${max}`);
    return n;
  };
  // URL de Personal (registro/recupero): https o mailto; en desarrollo también http. Nunca javascript:, data:, etc.
  const urlPersonal = (k) => {
    const v = env[k];
    if (!v) return '';
    let u;
    try { u = new URL(v); } catch { throw new Error(`${k} no es una URL válida`); }
    if (!(u.protocol === 'https:' || u.protocol === 'mailto:' || (desarrollo && u.protocol === 'http:'))) {
      throw new Error(`${k} debe ser https (o mailto)`);
    }
    return v;
  };
  // Fail-closed: solo NODE_ENV=development explícito habilita lo inseguro (semillas de prueba, clave efímera,
  // TRUST_PROXY=true, COOKIE_SECURE=false, http, adaptador de prueba). Cualquier otro valor (staging, vacío)
  // se comporta como producción.
  const desarrollo = env.NODE_ENV === 'development';
  const produccion = !desarrollo;
  if (produccion) {
    for (const k of ['SSO_ISSUER', 'PORTAL_URL']) {
      let u;
      try { u = new URL(env[k]); } catch { throw new Error(`${k} no es una URL válida`); }
      if (u.protocol !== 'https:') throw new Error(`${k} debe ser https fuera de NODE_ENV=development`);
    }
    if (env.COOKIE_SECURE === 'false') throw new Error('COOKIE_SECURE=false solo se admite con NODE_ENV=development');
  }
  if (!desarrollo && !env.ALTCHA_HMAC_KEY) {
    throw new Error('Falta la variable de entorno ALTCHA_HMAC_KEY (solo se admite clave efímera con NODE_ENV=development)');
  }
  if (!desarrollo && env.ALTCHA_HMAC_KEY.length < HMAC_MIN) {
    throw new Error(`ALTCHA_HMAC_KEY debe tener al menos ${HMAC_MIN} caracteres`);
  }
  // Adaptador de Personal. El de PRUEBA en producción solo con permiso explícito (despliegue temporal).
  const adaptador = env.PERSONAL_ADAPTER || 'prueba';
  const permisoPrueba = env.PORTAL_PERMITIR_ADAPTADOR_PRUEBA === '1';
  if (adaptador === 'prueba' && produccion && !permisoPrueba) {
    throw new Error("PERSONAL_ADAPTER='prueba' solo se admite con NODE_ENV=development o con PORTAL_PERMITIR_ADAPTADOR_PRUEBA=1");
  }
  const modoPrueba = adaptador === 'prueba' && produccion && permisoPrueba;
  return {
    produccion,
    desarrollo,
    puerto: num('PORT', 3000),
    databaseUrl: req('DATABASE_URL'),
    issuer: req('SSO_ISSUER'),
    portalUrl: req('PORTAL_URL'),
    privateKeyPath: env.SSO_PRIVATE_KEY_PATH || null,
    privateKey: env.SSO_PRIVATE_KEY || null,
    kid: env.SSO_KID || null,
    altchaHmacKey: env.ALTCHA_HMAC_KEY || null,
    registroUrl: urlPersonal('PERSONAL_REGISTRO_URL'),
    recuperoUrl: urlPersonal('PERSONAL_RECUPERO_URL'),
    // Secure activo por defecto; solo se apaga con COOKIE_SECURE=false (desarrollo http).
    // Path de la cookie de sesión (p. ej. '/portal'): evita que viaje a otras apps del mismo dominio.
    basePath: leerBasePath(env.PORTAL_BASE_PATH),
    cookieSecure: env.COOKIE_SECURE !== 'false',
    trustProxy: leerTrustProxy(env.TRUST_PROXY, produccion),
    altcha: {
      maxnumber: num('ALTCHA_MAXNUMBER', 1_000_000, MAXNUMBER_MIN, MAXNUMBER_MAX),
      porIpMin: num('ALTCHA_LIMITE_IP_MIN', 30, 1, LIMITE_MAX),
    },
    // Pedidos por minuto: /api/entrar por sesión y tarjetas con forzar=1 por sesión.
    pedidos: { entrarMin: num('LIMITE_ENTRAR_MIN', 30, 1, LIMITE_MAX), forzarMin: num('LIMITE_FORZAR_MIN', 6, 1, LIMITE_MAX) },
    purgaSeg: num('PURGA_INTERVALO_SEG', 600, 10, 86_400),
    jtiRetencionDias: num('JTI_RETENCION_DIAS', 30, 1, 3650),
    sesionSegundos: 8 * 3600,
    limites: {
      ventanaSeg: num('LIMITE_VENTANA_SEG', 900, 60, 86_400),
      porPar: num('LIMITE_POR_PAR', 5, 1, LIMITE_MAX),               // fallos por (correo, IP): bloquea solo ese par
      porCorreo: num('LIMITE_POR_CORREO', 50, 1, LIMITE_MAX),        // freno global por correo (adivinanza distribuida masiva)
      porIp: num('LIMITE_POR_IP', 20, 1, LIMITE_MAX),
      // IPs con un ingreso exitoso de ese correo en estos días no cuentan para el tope GLOBAL por correo.
      confianzaDias: 30,
    },
    tarjetas: { timeoutMs: num('TARJETAS_TIMEOUT_MS', 3000, 200, 10_000), cacheSeg: num('TARJETAS_CACHE_SEG', 600, 1, 3600) },
    personal: { adaptador, databaseUrl: env.PERSONAL_DATABASE_URL || null },
    // Despliegue temporal con Personal de PRUEBA en producción: sin semillas, aviso en logs y en la UI.
    modoPrueba,
  };
}
