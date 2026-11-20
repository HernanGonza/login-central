// PUNTO DE EXTENSION - Alerta.
// PENDIENTE: confirmar cómo Alerta abre hoy su sesión (cookie propia, JWT propio, tabla de sesiones...).
// Implementar aquí la apertura de sesión y devolver un 302 al inicio de Alerta con la sesión abierta
// (Set-Cookie HttpOnly/Secure, o fragmento de URL si es un front con token).
// No tocar el login propio de Alerta: esto es una vía adicional.
import type { Claims } from "./verificar.ts";
import type { Usuario } from "./handler.ts";

export function crearAbrirSesionAlerta(_o: { inicioUrl: string }) {
  return (_req: Request, _usuario: Usuario, _claims: Claims): Promise<Response> => {
    // Mientras no esté implementado, el handler responde "sin acceso" (falla cerrada).
    return Promise.reject(new Error("abrirSesionAlerta no implementado"));
  };
}
