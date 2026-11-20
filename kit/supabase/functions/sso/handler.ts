// Rutas /sso/acceso y /sso/login. Toda dependencia externa se inyecta (pruebas sin red ni base).
import type { CompactVerifyGetKey } from "jose";
import { type Claims, type Use, verificarPase } from "./verificar.ts";

export interface Usuario { id: string; rol?: string | null; activo: boolean }

export interface Deps {
  iss: string;
  aud: string;
  portalUrl: string;
  /** Origen del portal para la defensa CSRF de /sso/login (def.: el origen de portalUrl, o sea SSO_PORTAL_URL). */
  origenPortal?: string;
  getKey: CompactVerifyGetKey;
  ahora: () => number;
  marcarJti: (jti: string, exp: number) => Promise<boolean>;
  /** Misma función en consulta e ingreso. Recibe el correo ya en minúsculas. */
  buscarUsuarioPorCorreo: (email: string) => Promise<Usuario | null>;
  /** Abre la sesión propia y devuelve la respuesta (normalmente 302). */
  abrirSesion: (req: Request, usuario: Usuario, claims: Claims) => Promise<Response>;
  log?: (msg: string) => void;
}

const SIN_CACHE = { "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" };

/**
 * CSRF de login: con Origin debe ser el del portal ("null" se rechaza); sin Origin se rechaza
 * Sec-Fetch-Site: cross-site; sin ninguno de los dos se acepta (clientes sin cabeceras).
 */
export function origenPermitido(req: Request, origenPortal: string): boolean {
  const origin = req.headers.get("origin");
  if (origin !== null) return origin === origenPortal;
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs !== null) return sfs.trim().toLowerCase() !== "cross-site";
  return true;
}

function json(status: number, cuerpo: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SIN_CACHE, ...extra },
  });
}

function paginaSinAcceso(portalUrl: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Sin acceso</title>
<body style="font-family:sans-serif;background:#f4f7f4;text-align:center;padding:4rem">
<h1>No tenés acceso a este sistema</h1>
<p><a href="${esc(portalUrl)}" style="color:#2f6b4a">Volver al portal</a></p></body></html>`;
  return new Response(html, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", ...SIN_CACHE, "Referrer-Policy": "no-referrer" },
  });
}

export function crearHandler(d: Deps) {
  const log = d.log ?? (() => {});
  const origenEsperado = new URL(d.origenPortal ?? d.portalUrl).origin;
  const verificar = (token: string, use: Use) =>
    verificarPase(token, { use, iss: d.iss, aud: d.aud, getKey: d.getKey, ahora: d.ahora, marcarJti: d.marcarJti });

  async function acceso(req: Request): Promise<Response> {
    if (req.method !== "GET") return json(405, { error: "metodo" }, { Allow: "GET" });
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
    if (!m) return json(401, { error: "no autorizado" });
    const r = await verificar(m[1], "acceso");
    if (!r.ok) { log(`acceso rechazado: ${r.motivo}`); return json(401, { error: "no autorizado" }); }
    const u = await d.buscarUsuarioPorCorreo(r.claims.email.trim().toLowerCase());
    if (!u || !u.activo) return json(200, { acceso: false });
    return json(200, u.rol ? { acceso: true, rol: u.rol } : { acceso: true });
  }

  async function login(req: Request): Promise<Response> {
    if (req.method !== "POST") return json(405, { error: "metodo" }, { Allow: "POST" });
    if (!origenPermitido(req, origenEsperado)) { log("login rechazado: origen"); return paginaSinAcceso(d.portalUrl); }
    const ct = (req.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.startsWith("application/x-www-form-urlencoded")) return paginaSinAcceso(d.portalUrl);
    let token = "";
    try { token = new URLSearchParams(await req.text()).get("token") ?? ""; } catch { /* vacío */ }
    const r = await verificar(token, "login");
    if (!r.ok) { log(`login rechazado: ${r.motivo}`); return paginaSinAcceso(d.portalUrl); }
    const u = await d.buscarUsuarioPorCorreo(r.claims.email.trim().toLowerCase());
    if (!u || !u.activo) return paginaSinAcceso(d.portalUrl);
    try {
      return await d.abrirSesion(req, u, r.claims);
    } catch (e) {
      log(`abrirSesion fallo: ${(e as Error).name}`); // sin mensaje: podría contener datos sensibles
      return paginaSinAcceso(d.portalUrl);
    }
  }

  return async (req: Request): Promise<Response> => {
    try {
      const p = new URL(req.url).pathname.replace(/\/+$/, "");
      if (p.endsWith("/sso/acceso")) return await acceso(req);
      if (p.endsWith("/sso/login")) return await login(req);
      return json(404, { error: "no encontrado" });
    } catch (e) {
      // Falla cerrada y sin detalle (p. ej. falló el RPC de jti o de usuario): login -> 403, acceso -> 401.
      log(`error interno: ${(e as Error).name}`);
      const p = (() => { try { return new URL(req.url).pathname.replace(/\/+$/, ""); } catch { return ""; } })();
      if (p.endsWith("/sso/login")) return paginaSinAcceso(d.portalUrl);
      if (p.endsWith("/sso/acceso")) return json(401, { error: "no autorizado" });
      return json(500, { error: "error interno" });
    }
  };
}
