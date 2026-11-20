// Resolución de correo -> empleado. Compartida por ingreso y por emisión de pases.
export const MENSAJES = {
  noEncontrado: 'No encontramos tu correo',
  duplicado:
    'Tu correo figura más de una vez. Contactate con el equipo de desarrollo: desarrollo@ecologia.misiones.gob.ar',
};

export function normalizarCorreo(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * @returns {Promise<{estado:'vacio'|'no_encontrado'|'duplicado'|'ok', correo:string, empleado?:object}>}
 */
export async function resolverCorreo(personal, email) {
  const correo = normalizarCorreo(email);
  if (!correo) return { estado: 'vacio', correo };
  const encontrados = await personal.buscarPorCorreo(correo);
  if (encontrados.length === 0) return { estado: 'no_encontrado', correo };
  if (encontrados.length > 1) return { estado: 'duplicado', correo };
  return { estado: 'ok', correo, empleado: encontrados[0] };
}
