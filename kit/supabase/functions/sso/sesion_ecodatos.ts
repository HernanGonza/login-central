// Sesión Ecodatos: generateLink (sin enviar correo) + verifyOtp en el servidor.
// La sesión se entrega en el FRAGMENTO de la URL (no llega a logs ni al Referer);
// el front de Ecodatos debe llamar supabase.auth.setSession({access_token, refresh_token}).
import { createClient } from "@supabase/supabase-js";
import type { Claims } from "./verificar.ts";
import type { Usuario } from "./handler.ts";

export function crearAbrirSesionEcodatos(o: {
  supabaseUrl: string; serviceKey: string; anonKey: string; inicioUrl: string;
}) {
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(o.supabaseUrl, o.serviceKey, opts);
  const publico = createClient(o.supabaseUrl, o.anonKey, opts);

  return async (_req: Request, _u: Usuario, claims: Claims): Promise<Response> => {
    const email = claims.email.trim().toLowerCase();
    // generateLink solo crea el enlace; NO envía correo.
    const { data: g, error: e1 } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const hash = g?.properties?.hashed_token;
    if (e1 || !hash) throw new Error("generateLink");
    const { data: v, error: e2 } = await publico.auth.verifyOtp({ token_hash: hash, type: "magiclink" });
    const s = v?.session;
    if (e2 || !s) throw new Error("verifyOtp");
    const frag = new URLSearchParams({
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_in: String(s.expires_in),
      token_type: "bearer",
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${o.inicioUrl}#${frag}`,
        "Cache-Control": "no-store, max-age=0",
        "Pragma": "no-cache",
        "Referrer-Policy": "no-referrer",
      },
    });
  };
}
