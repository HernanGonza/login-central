// Sistema falso: Express + kit real (kit/node, paquete @ecologia/sso-kit-node, workspace de npm).
import { randomBytes } from 'node:crypto';
import express from 'express';
import { crearVerificador, crearRutasSSO } from '@ecologia/sso-kit-node';
import { crearBuscador } from './usuarios.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PREFIJO_COOKIE = 'sf_sesion';
const SESION_MS = 28800 * 1000; // igual al Max-Age de la cookie (8 h)
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);
const hostDe = (v) => { try { return new URL(v).hostname; } catch { return null; } };

const pagina = (titulo, cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>body{font-family:Figtree,system-ui,sans-serif;background:#f4f7f4;color:#1c2b22;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;padding:2rem 2.5rem;border-radius:12px;box-shadow:0 2px 12px #0001;max-width:30rem}
h1{color:#2f6b4a;margin-top:0}a{color:#2f6b4a;font-weight:600}</style></head><body><main>${cuerpo}</main></body></html>`;

function leerCookie(req, nombre) {
  for (const par of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = par.trim().split('=');
    if (k === nombre) {
      try { return decodeURIComponent(v.join('=')); } catch { return null; } // cookie mal formada -> sin sesión
    }
  }
  return null;
}

export function crearApp({ usuarios, config }) {
  const {
    issuer, audience, jwks, jwksUrl, ahora, portalUrl, cooldownJwks, origenPortal = portalUrl,
    cookieSecure = true, modoInicial = 'normal', control = false,
  } = config;
  // Cookie por sistema: las cookies no distinguen puertos y en desarrollo comparten host.
  const nombreCookie = `${PREFIJO_COOKIE}_${String(audience).replace(/[^a-z0-9_-]/gi, '')}`;
  const buscarUsuarioPorCorreo = crearBuscador(usuarios);
  const sesiones = new Map(); // sid -> { nombre, email, rol, id, vence }
  const reloj = config.relojSesion ?? Date.now;
  const sesionVigente = (sid) => {
    const s = sid ? sesiones.get(sid) : null;
    if (!s) return null;
    if (reloj() >= s.vence) { sesiones.delete(sid); return null; }
    return s;
  };
  const estado = { modo: modoInicial }; // normal | caido | lento

  const app = express();
  app.disable('x-powered-by');

  // Simulación de caída / lentitud (para probar la tarjeta gris del portal).
  app.use((req, res, next) => {
    if (req.path.startsWith('/_control')) return next();
    if (estado.modo === 'caido') return res.status(503).type('text').send('no disponible');
    if (estado.modo === 'lento') return void setTimeout(next, config.retardoLentoMs ?? 5000);
    next();
  });

  if (control) {
    // Solo para pruebas locales: POST /_control?modo=normal|caido|lento (solo loopback)
    app.post('/_control', (req, res) => {
      // CSRF: con SF_CONTROL_TOKEN se exige la cabecera x-control-token; sin ella, un Origin
      // presente debe ser loopback o el mismo host. Sin Origin (curl) se permite.
      // DNS rebinding: el Host debe ser loopback (localhost, 127.0.0.1, [::1]), con o sin puerto.
      const hostCab = hostDe(`http://${req.get('host') ?? ''}`);
      if (!hostCab || !LOOPBACK.has(hostCab)) return res.sendStatus(403);
      if (process.env.SF_CONTROL_TOKEN) {
        if (req.get('x-control-token') !== process.env.SF_CONTROL_TOKEN) return res.sendStatus(403);
      } else {
        const origen = req.get('origin');
        if (origen !== undefined) {
          const h = hostDe(origen);
          if (!h || !LOOPBACK.has(h)) return res.sendStatus(403);
        }
      }
      const ip = req.socket.remoteAddress ?? '';
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return res.sendStatus(403);
      if (!['normal', 'caido', 'lento'].includes(req.query.modo)) return res.sendStatus(400);
      estado.modo = req.query.modo;
      res.json({ modo: estado.modo });
    });
  }

  app.use('/sso', (req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache'); next(); });

  function abrirSesion(req, res, usuario) {
    const sid = randomBytes(32).toString('hex');
    sesiones.set(sid, { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, vence: reloj() + SESION_MS });
    const attrs = ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=28800'];
    if (cookieSecure) attrs.push('Secure');
    res.append('Set-Cookie', `${nombreCookie}=${sid}; ${attrs.join('; ')}`);
  }

  const verificar = crearVerificador({
    issuer, audience, jwks, jwksUrl, ahora, cooldownJwks, buscarUsuarioPorCorreo,
    permitirMemoria: true, // sistema de prueba: un solo proceso, jti en memoria
  });
  app.use(crearRutasSSO({ verificar, abrirSesion, inicioUrl: '/', portalUrl, origenPortal }));

  app.get('/', (req, res) => {
    const s = sesionVigente(leerCookie(req, nombreCookie));
    res.set('Cache-Control', 'no-store');
    if (!s) return res.status(401).type('html').send(pagina('Sistema falso',
      `<h1>Sistema falso</h1><p>No hay sesión abierta.</p><p><a href="${esc(portalUrl)}">Ingresar por el portal</a></p>`));
    res.type('html').send(pagina('Sistema falso',
      `<h1>Sistema falso</h1><p>Sesión abierta como <strong>${esc(s.nombre)}</strong> (${esc(s.email)}).</p>
<p>Rol: <strong>${esc(s.rol ?? 'sin rol')}</strong></p>`));
  });

  app.estado = estado;
  app.sesiones = sesiones;
  return app;
}
