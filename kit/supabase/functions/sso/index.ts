// Edge Function `sso` (Supabase). Rutas: /functions/v1/sso/acceso (GET) y /functions/v1/sso/login (POST).
// Variables: SSO_JWKS_URL (https; SSO_PERMITIR_HTTP=1 solo desarrollo), SSO_ISSUER, SSO_AUD, SSO_SISTEMA (ecodatos|alerta), SSO_INICIO_URL, SSO_PORTAL_URL,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (solo ecodatos).
// Alerta: tabla/columnas en sso.alerta_config (ver sql/001_sso.sql).
import { createClient } from "@supabase/supabase-js";
import { crearHandler, type Usuario } from "./handler.ts";
import { crearGetKeyRemoto } from "./verificar.ts";
import { crearAbrirSesionEcodatos } from "./sesion_ecodatos.ts";
import { crearAbrirSesionAlerta } from "./sesion_alerta.ts";

const req = (n: string) => {
  const v = Deno.env.get(n);
  if (!v) throw new Error(`Falta variable ${n}`);
  return v;
};

const sistema = req("SSO_SISTEMA");
const supabaseUrl = req("SUPABASE_URL");
const serviceKey = req("SUPABASE_SERVICE_ROLE_KEY");
const inicioUrl = req("SSO_INICIO_URL");
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const sso = db.schema("sso"); // el schema `sso` debe estar expuesto en PostgREST (ver README)

async function buscarUsuarioPorCorreo(email: string): Promise<Usuario | null> {
  const fn = sistema === "alerta" ? "buscar_usuario_alerta" : "buscar_usuario_ecodatos";
  const { data, error } = await sso.rpc(fn, { p_email: email });
  if (error) throw new Error("rpc buscar usuario");
  const f = Array.isArray(data) ? data : data ? [data] : [];
  if (f.length !== 1) return null; // 0 o duplicado: sin acceso
  return { id: String(f[0].id), rol: f[0].rol ?? null, activo: !!f[0].activo };
}

async function marcarJti(jti: string, exp: number): Promise<boolean> {
  const { data, error } = await sso.rpc("marcar_jti", { p_jti: jti, p_exp: exp });
  if (error) throw new Error("rpc marcar_jti");
  return data === true;
}

const abrirSesion = sistema === "alerta"
  ? crearAbrirSesionAlerta({ inicioUrl })
  : crearAbrirSesionEcodatos({ supabaseUrl, serviceKey, anonKey: req("SUPABASE_ANON_KEY"), inicioUrl });

const handler = crearHandler({
  iss: req("SSO_ISSUER"),
  aud: req("SSO_AUD"),
  portalUrl: req("SSO_PORTAL_URL"),
  getKey: crearGetKeyRemoto(req("SSO_JWKS_URL"), Deno.env.get("SSO_PERMITIR_HTTP") === "1"),
  ahora: () => Math.floor(Date.now() / 1000),
  marcarJti,
  buscarUsuarioPorCorreo,
  abrirSesion,
  log: (m) => console.log(`[sso] ${m}`),
});

Deno.serve(handler);
