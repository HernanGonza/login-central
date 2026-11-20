// Cliente de la API del emisor (server/). Forma de las respuestas: ver web/README.md.
// Base de la app (vite `base`): '/' en desarrollo y subdominio propio, '/portal/' bajo ecodatos.
// Todas las rutas a la API cuelgan de ella (el nginx de ecodatos quita el prefijo antes de llegar a portal-web).
export const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
export const apiUrl = (ruta, base = BASE) => base.replace(/\/+$/, '') + ruta;

const opts = (metodo, cuerpo) => ({
  method: metodo,
  credentials: 'same-origin',
  headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
  body: cuerpo ? JSON.stringify(cuerpo) : undefined,
});

async function pedir(metodo, ruta, cuerpo) {
  const r = await fetch(apiUrl(ruta), opts(metodo, cuerpo));
  let data = null;
  try { data = r.status === 204 ? null : await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, ok: r.ok, data, retryAfter: Number(r.headers?.get?.('Retry-After')) || null };
}

const q = (params) => {
  const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return p.size ? `?${p}` : '';
};

export const api = {
  config: () => pedir('GET', '/api/config'),
  sesion: (volver) => pedir('GET', `/api/sesion${q({ volver })}`),
  ingreso: (email, clave, altcha, volver) => pedir('POST', '/api/ingreso', { email, clave, altcha, volver: volver || undefined }),
  salir: () => pedir('POST', '/api/salir'),
  // Lista inmediata; con forzar=1 el servidor descarta su caché de la sesión.
  tarjetas: (forzar = false) => pedir('GET', `/api/tarjetas${q({ forzar: forzar ? '1' : '' })}`),
  // Una consulta por tarjeta (timeout de 3 s en el servidor).
  estado: (id, forzar = false) =>
    pedir('GET', `/api/tarjetas/${encodeURIComponent(id)}/estado${q({ forzar: forzar ? '1' : '' })}`),
  entrar: (id) => pedir('POST', `/api/entrar/${encodeURIComponent(id)}`),
};

// POST autoenviado por formulario oculto: el pase nunca viaja en la URL.
export function enviarPost(url_login, token) {
  let u;
  try { u = new URL(url_login); } catch { throw new Error('url_login inválida'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('url_login debe ser http: o https:');
  const f = document.createElement('form');
  f.method = 'POST';
  f.action = u.href;
  f.style.display = 'none';
  const i = document.createElement('input');
  i.type = 'hidden';
  i.name = 'token';
  i.value = token;
  f.appendChild(i);
  document.body.appendChild(f);
  f.submit();
}
