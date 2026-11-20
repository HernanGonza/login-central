// Lista fija de correos con roles. Fuente (en orden):
//   SF_USUARIOS_JSON  -> JSON inline o ruta a un archivo JSON
//   SF_USUARIOS       -> "correo:rol,correo:rol" (rol opcional; "!correo" = inactivo)
//   por defecto       -> lista de prueba (coincide con los vectores)
// Formato JSON: [{"email":"a@x","rol":"admin","nombre":"Ana","activo":true}]
import { readFileSync, existsSync } from 'node:fs';

export const USUARIOS_DEFECTO = [
  { email: 'ana.perez@ecologia.test', nombre: 'Ana Pérez', rol: 'admin', activo: true },
  { email: 'luis.gomez@ecologia.test', nombre: 'Luis Gómez', rol: 'usuario', activo: true },
  { email: 'inactivo@ecologia.test', nombre: 'Inactivo', rol: 'usuario', activo: false },
];

export function cargarUsuarios(env = process.env) {
  let lista;
  const j = env.SF_USUARIOS_JSON;
  if (j) {
    lista = JSON.parse(existsSync(j) ? readFileSync(j, 'utf8') : j);
  } else if (env.SF_USUARIOS) {
    lista = env.SF_USUARIOS.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const inactivo = s.startsWith('!');
      const [email, rol] = (inactivo ? s.slice(1) : s).split(':');
      return { email, rol: rol || undefined, activo: !inactivo };
    });
  } else {
    lista = USUARIOS_DEFECTO;
  }
  return lista.map((u, i) => ({
    id: u.id ?? `sf-${i + 1}`,
    email: String(u.email).trim().toLowerCase(),
    nombre: u.nombre ?? String(u.email).split('@')[0],
    rol: u.rol,
    activo: u.activo !== false,
  }));
}

// Misma función para consulta (/sso/acceso) e ingreso (/sso/login).
export function crearBuscador(usuarios) {
  const mapa = new Map(usuarios.map((u) => [u.email, u]));
  return function buscarUsuarioPorCorreo(email) {
    const u = mapa.get(String(email ?? '').trim().toLowerCase());
    return u ? { ...u } : null;
  };
}
