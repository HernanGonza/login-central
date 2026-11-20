import express from 'express';
import cookieParser from 'cookie-parser';
import { resolverCorreo, normalizarCorreo, MENSAJES } from './correo.js';
import { crearEmisor } from './pases.js';
import { crearLimites } from './limites.js';
import { crearAltcha } from './altcha.js';
import { crearSesiones } from './sesiones.js';
import { claveIp } from './ip.js';
import { crearLimitadorPedidos } from './pedidos.js';
import { crearTarjetas, sistemaActivo, sistemasActivos, validarVolver } from './tarjetas.js';

/**
 * Dependencias inyectables: { config, pool, personal, claves, log, fetchImpl?, ahora? (seg), ahoraMs? }
 */
export function crearApp(deps) {
  const { config, pool, personal, claves, log } = deps;
  const emisor = crearEmisor({ claves, issuer: config.issuer, pool, ahora: deps.ahora });
  const sesiones = crearSesiones({ pool, config });
  const limites = crearLimites({ pool, config });
  const altcha = crearAltcha({ pool, hmacKey: config.altchaHmacKey, maxnumber: config.altcha.maxnumber });
  const tarjetas = crearTarjetas({
    pool, sesiones, emisor, config, log, fetchImpl: deps.fetchImpl, ahora: deps.ahoraMs,
  });
  const limAltcha = crearLimitadorPedidos({ max: config.altcha.porIpMin, ahora: deps.ahoraMs });
  const limEntrar = crearLimitadorPedidos({ max: config.pedidos.entrarMin, ahora: deps.ahoraMs });
  const limForzar = crearLimitadorPedidos({ max: config.pedidos.forzarMin, ahora: deps.ahoraMs });
  const optsSis = { desarrollo: config.desarrollo, log };
  const origenPortal = new URL(config.portalUrl).origin;

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  // form-action: 'self' y los orígenes de url_login de los sistemas activos (caché corto).
  let origenesForm = { ts: 0, lista: [] };
  const formAction = async () => {
    if ((deps.ahoraMs ?? Date.now)() - origenesForm.ts > 30_000) {
      const lista = [...new Set((await sistemasActivos(pool, optsSis)).map((s) => new URL(s.url_login).origin))];
      origenesForm = { ts: (deps.ahoraMs ?? Date.now)(), lista };
    }
    return ["'self'", ...origenesForm.lista].join(' ');
  };
  app.use(async (req, res, next) => {
    try {
      res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin',
        'Content-Security-Policy':
          `default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action ${await formAction()}`,
      });
      if (config.produccion) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
      next();
    } catch (e) { next(e); }
  });
  // Después de las cabeceras: también los errores de body-parser las llevan.
  app.use(express.json({ limit: '8kb' }));
  app.use(cookieParser());
  const demasiados = (res, l) => res.set('Retry-After', String(l.reintentarSeg)).status(429)
    .json({ error: 'demasiados_pedidos', reintentarSeg: l.reintentarSeg });
  // Defensa extra contra POST entre sitios (además de SameSite=Lax).
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path.startsWith('/api/')) {
      const origen = req.headers.origin;
      if (origen) {
        if (origen !== origenPortal) return res.status(403).json({ error: 'origen' });
      } else if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') {
        return res.status(403).json({ error: 'origen' }); // sin Origin: misma regla que los kits
      }
    }
    next();
  });

  const exigirSesion = async (req, res, next) => {
    const s = await sesiones.leer(req);
    if (!s) return res.status(401).json({ error: 'sin_sesion' });
    req.sesion = s;
    next();
  };

  app.get('/.well-known/jwks.json', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300').json(claves.jwks);
  });

  app.get('/api/config', (req, res) => {
    res.json({ registroUrl: config.registroUrl, recuperoUrl: config.recuperoUrl, modo_prueba: !!config.modoPrueba });
  });

  app.get('/api/altcha', async (req, res) => {
    const l = limAltcha.golpe(claveIp(req.ip));
    if (!l.permitido) return demasiados(res, l);
    res.json(await altcha.desafio());
  });

  app.post('/api/ingreso', async (req, res) => {
    const { email, clave, altcha: solucion, volver } = req.body ?? {};
    const ip = claveIp(req.ip);

    if (!(await altcha.verificar(solucion))) {
      log('ingreso_rechazado', { motivo: 'captcha', ip });
      return res.status(400).json({ error: 'captcha' });
    }

    const correo = normalizarCorreo(email);
    const lim = await limites.reservar(correo, ip); // atómico: cuenta y reserva antes de verificar la clave
    if (!lim.permitido) {
      log('ingreso_rechazado', { motivo: 'limite', ip });
      return res.set('Retry-After', String(lim.reintentarSeg)).status(429)
        .json({ error: 'demasiados_intentos', reintentarSeg: lim.reintentarSeg });
    }

    let ok = false;
    let r;
    try {
      r = await resolverCorreo(personal, email);
      if (r.estado !== 'ok') {
        await personal.igualarTiempo?.(clave); // sin canal de tiempo entre correo existente e inexistente
      } else {
        // Se verifica siempre, también para inactivos, para que el tiempo no delate el estado.
        const claveOk = await personal.verificarClave(r.empleado, clave);
        ok = r.empleado.activo && claveOk;
      }
    } finally {
      await limites.resolver(lim.id, correo, ip, ok); // si algo falla queda como fallido
    }

    if (r.estado === 'vacio' || r.estado === 'no_encontrado') {
      log('ingreso_rechazado', { motivo: r.estado, ip });
      return res.status(r.estado === 'vacio' ? 400 : 404).json({
        error: r.estado === 'vacio' ? 'correo_vacio' : 'correo_no_encontrado',
        mensaje: MENSAJES.noEncontrado,
        registroUrl: config.registroUrl,
      });
    }
    if (r.estado === 'duplicado') {
      log('ingreso_rechazado', { motivo: 'duplicado', ip });
      return res.status(409).json({ error: 'correo_duplicado', mensaje: MENSAJES.duplicado });
    }
    if (!ok) {
      log('ingreso_rechazado', { motivo: 'credenciales', ip });
      return res.status(401).json({ error: 'credenciales', recuperoUrl: config.recuperoUrl });
    }

    await sesiones.crear(res, r.empleado);
    log('ingreso_ok', { empleado: r.empleado.id });
    res.json({ ok: true, nombre: r.empleado.nombre, volver: await validarVolver(pool, volver, optsSis) });
  });

  app.get('/api/sesion', exigirSesion, async (req, res) => {
    const [nombre] = req.sesion.nombre.split(' ');
    res.json({
      empleado: { id: req.sesion.empleado_id, nombre, nombreCompleto: req.sesion.nombre, email: req.sesion.email },
      volver: await validarVolver(pool, req.query.volver, optsSis),
    });
  });

  app.post('/api/salir', async (req, res) => {
    await sesiones.destruir(req, res); // no toca las sesiones de los sistemas
    res.json({ ok: true });
  });

  const forzar = (req) => req.query.forzar === '1' || req.query.forzar === 'true';
  // forzar=1 salta el caché y dispara consultas a los sistemas: se limita por sesión.
  const limitarForzar = (req, res, next) => {
    if (!forzar(req)) return next();
    const l = limForzar.golpe(req.sesion.idHash);
    return l.permitido ? next() : demasiados(res, l);
  };

  // Lista inmediata (siempre_visible ya "disponible"; el resto "consultando" o lo que diga el caché).
  app.get('/api/tarjetas', exigirSesion, limitarForzar, async (req, res) => {
    res.json({ tarjetas: await tarjetas.listar(req.sesion, { forzar: forzar(req) }) });
  });
  // Todas en paralelo (timeout 3 s por sistema), respuesta al terminar la última.
  app.get('/api/tarjetas/estado', exigirSesion, limitarForzar, async (req, res) => {
    res.json({ tarjetas: await tarjetas.consultarTodas(req.sesion, { forzar: forzar(req) }) });
  });
  // Una sola: el cliente lanza una por tarjeta y cada una aparece al responder.
  app.get('/api/tarjetas/:id/estado', exigirSesion, limitarForzar, async (req, res) => {
    const s = await sistemaActivo(pool, req.params.id, optsSis);
    if (!s) return res.status(404).json({ error: 'sistema' });
    res.json({ tarjeta: await tarjetas.consultar(req.sesion, s, { forzar: forzar(req) }) });
  });

  // Devuelve el pase login; el cliente lo envía por POST autoenviado a url_login. Nunca en URL.
  app.post('/api/entrar/:id', exigirSesion, (req, res, next) => {
    const l = limEntrar.golpe(req.sesion.idHash);
    return l.permitido ? next() : demasiados(res, l);
  }, async (req, res) => {
    const s = await sistemaActivo(pool, req.params.id, optsSis);
    if (!s) return res.status(404).json({ error: 'sistema' });
    const r = await resolverCorreo(personal, req.sesion.email);
    if (r.estado !== 'ok' || !r.empleado.activo) {
      log('entrar_rechazado', { motivo: r.estado, sistema: s.id });
      return res.status(403).json({ error: 'sin_acceso' });
    }
    const token = await emisor.emitir({ empleado: r.empleado, aud: s.id, use: 'login' });
    log('entrar_ok', { empleado: r.empleado.id, sistema: s.id });
    res.json({ url_login: s.url_login, token });
  });

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    // Nunca err.message (body-parser puede incluir fragmentos del cuerpo): solo tipo/nombre.
    log('error', { tipo: String(err?.type ?? err?.name ?? 'error').slice(0, 60) });
    if (res.headersSent) return;
    res.status(err.status && err.status < 500 ? err.status : 500).json({ error: 'interno' });
  });

  return app;
}
