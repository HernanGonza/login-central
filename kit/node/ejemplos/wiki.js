// Ejemplo de integración para la Wiki (piloto). No se ejecuta en las pruebas.
import express from 'express';
import { crearVerificador, crearRutasSSO } from '@ecologia/sso-kit-node';
import { crearBuscarUsuarioPorCorreo } from './wiki-usuarios.js';

// --- Implementado por la Wiki ---
// Misma búsqueda en consulta e ingreso (el kit la llama con { use, name }). El alta de un lector nuevo
// ocurre SOLO en el ingreso (use='login') y es atómica (UNIQUE(lower(email)) + ON CONFLICT DO NOTHING +
// volver a consultar); ver wiki-usuarios.js. Revocar = activo=false, nunca borrar la fila.
const buscarUsuarioPorCorreo = crearBuscarUsuarioPorCorreo(pool); // pool: node-postgres

function abrirSesion(req, res, usuario) {
  // Sesión propia de la Wiki (cookie HttpOnly, Secure, SameSite=Lax).
  req.session.usuarioId = usuario.id;
}

const verificar = crearVerificador({
  issuer: process.env.SSO_ISSUER,
  audience: process.env.SSO_AUDIENCE, // id de este sistema, ej. "wiki"
  jwksUrl: process.env.SSO_JWKS_URL,  // ej. https://portal.../.well-known/jwks.json
  buscarUsuarioPorCorreo,
  // jtiStore: almacenPostgres,       // ver src/jti-store.js
});

const app = express();
app.use(crearRutasSSO({
  verificar,
  abrirSesion,
  inicioUrl: '/',
  portalUrl: process.env.PORTAL_URL,
  alFallar: ({ ruta, motivo }) => console.warn(`sso ${ruta} rechazado: ${motivo}`),
}));
