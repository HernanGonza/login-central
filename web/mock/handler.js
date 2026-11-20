// Mock de la API del emisor (server/): refleja rutas, cuerpos y códigos reales de server/src/app.js.
// Función pura: (metodo, ruta[?query], cuerpo, estado) -> {status, body, headers?}.
// La usan tanto mock/server.mjs (dev) como las pruebas. Ver web/README.md.
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

export const SISTEMAS = [
  { id: 'personal', nombre: 'Personal', descripcion: 'Legajo, licencias y datos del empleado.', icono: 'users', siempre_visible: true },
  { id: 'wiki', nombre: 'Wiki', descripcion: 'Documentación y procedimientos internos.', icono: 'book', siempre_visible: true },
  { id: 'pesca', nombre: 'Pesca', descripcion: 'Permisos y registros de pesca.', icono: 'fish', siempre_visible: false },
];

// `consulta`: lo que respondería GET url_acceso de cada sistema.
//   {acceso:true, rol?} | {acceso:false} (-> sin_acceso) | {falla:true} (timeout/error -> no_disponible)
export function nuevoEstado() {
  return {
    sesion: null,
    cache: {}, // id -> entrada de caché (como en la sesión del servidor)
    consulta: { personal: { acceso: true }, wiki: { acceso: true, rol: 'administrador' }, pesca: { acceso: true } },
  };
}

const json = (status, body, headers) => ({ status, body, headers });
const HMAC = 'mock-altcha';

// Desafío ALTCHA v1 real (SHA-256), para que el widget pueda resolverlo en desarrollo.
function desafio() {
  const maxnumber = 2000;
  const salt = randomBytes(12).toString('hex');
  const challenge = createHash('sha256').update(salt + randomInt(maxnumber)).digest('hex');
  const signature = createHmac('sha256', HMAC).update(challenge).digest('hex');
  return { algorithm: 'SHA-256', challenge, maxnumber, salt, signature };
}

const vista = (s, e, ahora) => {
  const base = { id: s.id, nombre: s.nombre, descripcion: s.descripcion, icono: s.icono, siempre_visible: s.siempre_visible, rol: null };
  if (!e || ahora - e.ts > 600000) return { ...base, estado: s.siempre_visible ? 'disponible' : 'consultando', pendiente: true };
  if (e.estado === 'no_disponible' || e.estado === 'sin_acceso') {
    return { ...base, estado: s.siempre_visible ? 'disponible' : e.estado, pendiente: false };
  }
  return { ...base, estado: 'disponible', rol: e.rol ?? null, pendiente: false };
};

export function handle(metodo, ruta, cuerpo, estado, ahora = Date.now()) {
  const u = new URL(ruta, 'http://x');
  const path = u.pathname;
  const forzar = u.searchParams.get('forzar') === '1';
  const idValido = (id) => SISTEMAS.find((x) => x.id === id);
  const validarVolver = (v) => (idValido(v) ? v : null);

  if (metodo === 'GET' && path === '/api/config') {
    return json(200, { registroUrl: 'https://personal.example/registro', recuperoUrl: 'https://personal.example/recupero' });
  }
  if (metodo === 'GET' && path === '/api/altcha') return json(200, desafio());

  if (metodo === 'POST' && path === '/api/ingreso') {
    const { email = '', clave = '', altcha = '', volver } = cuerpo || {};
    if (!altcha || typeof altcha !== 'string') return json(400, { error: 'captcha' });
    const correo = String(email).trim().toLowerCase();
    if (correo === 'bloqueado@ecologia.test') {
      return json(429, { error: 'demasiados_intentos', reintentarSeg: 600 }, { 'Retry-After': '600' });
    }
    if (!correo) {
      return json(400, { error: 'correo_vacio', mensaje: 'No encontramos tu correo.', registroUrl: 'https://personal.example/registro' });
    }
    if (correo === 'nadie@ecologia.test') {
      return json(404, { error: 'correo_no_encontrado', mensaje: 'No encontramos tu correo.', registroUrl: 'https://personal.example/registro' });
    }
    if (correo === 'doble@ecologia.test') return json(409, { error: 'correo_duplicado', mensaje: 'Tu correo figura más de una vez.' });
    if (clave !== 'clave-prueba') return json(401, { error: 'credenciales', recuperoUrl: 'https://personal.example/recupero' });
    estado.sesion = { id: 'e1', nombre: 'Ana', nombreCompleto: 'Ana Gómez', email: correo };
    estado.cache = {};
    return json(200, { ok: true, nombre: 'Ana', volver: validarVolver(volver) });
  }
  if (metodo === 'POST' && path === '/api/salir') {
    estado.sesion = null;
    estado.cache = {};
    return json(200, { ok: true });
  }

  const sinSesion = json(401, { error: 'sin_sesion' });
  if (metodo === 'GET' && path === '/api/sesion') {
    if (!estado.sesion) return sinSesion;
    const { id, nombre, nombreCompleto, email } = estado.sesion;
    return json(200, { empleado: { id, nombre, nombreCompleto, email }, volver: validarVolver(u.searchParams.get('volver')) });
  }
  if (path.startsWith('/api/tarjetas') || path.startsWith('/api/entrar')) {
    if (!estado.sesion) return sinSesion;
  }

  if (metodo === 'GET' && path === '/api/tarjetas') {
    if (forzar) estado.cache = {};
    return json(200, { tarjetas: SISTEMAS.map((s) => vista(s, estado.cache[s.id], ahora)) });
  }
  let m;
  if (metodo === 'GET' && (m = path.match(/^\/api\/tarjetas\/([\w-]+)\/estado$/))) {
    const s = idValido(m[1]);
    if (!s) return json(404, { error: 'sistema' });
    let e = estado.cache[s.id];
    if (forzar || !e || ahora - e.ts > 600000) {
      const c = estado.consulta[s.id] || { falla: true };
      e = { ts: ahora, estado: c.falla ? 'no_disponible' : c.acceso ? 'disponible' : 'sin_acceso' };
      if (c.acceso && c.rol) e.rol = c.rol;
      estado.cache[s.id] = e;
    }
    return json(200, { tarjeta: vista(s, e, ahora) });
  }
  if (metodo === 'POST' && (m = path.match(/^\/api\/entrar\/([\w-]+)$/))) {
    const s = idValido(m[1]);
    if (!s) return json(404, { error: 'sistema' });
    return json(200, { url_login: `https://${s.id}.example/sso/login`, token: `pase-${s.id}` });
  }
  return json(404, { error: 'no_encontrado' });
}
