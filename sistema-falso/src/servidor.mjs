// Arranque: node src/servidor.mjs
// Variables: PORT (def. 4100), SSO_ISSUER, SSO_AUDIENCE (id del sistema), SSO_JWKS_URL, PORTAL_URL,
//   COOKIE_SECURE (def. true; "false" para http local), SF_MODO (normal|caido|lento), SF_CONTROL=1,
//   SF_USUARIOS / SF_USUARIOS_JSON
import { pathToFileURL } from 'node:url';
import { crearApp } from './app.mjs';
import { cargarUsuarios } from './usuarios.mjs';

export function configDesdeEnv(env = process.env) {
  const req = (k) => { if (!env[k]) throw new Error(`Falta la variable ${k}`); return env[k]; };
  return {
    issuer: req('SSO_ISSUER'),
    audience: req('SSO_AUDIENCE'),
    jwksUrl: req('SSO_JWKS_URL'),
    portalUrl: req('PORTAL_URL'),
    origenPortal: env.PORTAL_ORIGEN ?? req('PORTAL_URL'), // defensa CSRF de POST /sso/login (origen del portal)
    cookieSecure: env.COOKIE_SECURE !== 'false',
    modoInicial: env.SF_MODO ?? 'normal',
    control: env.SF_CONTROL === '1',
  };
}

// Devuelve { url, apagar() }. apagar() cierra el servidor (la tarjeta del portal queda gris).
export async function iniciar({ config, usuarios, port = 0, host = '127.0.0.1' }) {
  const app = crearApp({ config, usuarios });
  const server = await new Promise((ok, fail) => {
    const s = app.listen(port, host, () => ok(s));
    s.once('error', fail);
  });
  const sockets = new Set();
  server.on('connection', (c) => { sockets.add(c); c.on('close', () => sockets.delete(c)); });
  return {
    app,
    url: `http://${host}:${server.address().port}`,
    apagar: () => new Promise((ok) => { server.close(() => ok()); for (const c of sockets) c.destroy(); }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sis = await iniciar({
    config: configDesdeEnv(), usuarios: cargarUsuarios(),
    port: Number(process.env.PORT ?? 4100),
  });
  console.log(`sistema-falso escuchando en ${sis.url}`);
  const salir = () => sis.apagar().then(() => process.exit(0));
  process.on('SIGINT', salir);
  process.on('SIGTERM', salir);
}
