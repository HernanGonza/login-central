// Búsqueda/alta de usuarios de la Wiki (ejemplo). `db` es un pool estilo node-postgres: db.query(sql, params) -> { rows }.
//
// Esquema requerido (el alta es atómica gracias al índice único):
//   CREATE TABLE usuarios (
//     id BIGSERIAL PRIMARY KEY, email text NOT NULL, rol text NOT NULL DEFAULT 'lector',
//     activo boolean NOT NULL DEFAULT true);
//   CREATE UNIQUE INDEX usuarios_email_uq ON usuarios (lower(email));
//
// Para REVOCAR el acceso de una persona hay que poner activo=false; NO borrar la fila:
// si se borra, el próximo login válido la recrea como lector activo.
export function crearBuscarUsuarioPorCorreo(db) {
  const consultar = async (email) =>
    (await db.query('SELECT id, rol, activo FROM usuarios WHERE lower(email) = $1', [email])).rows[0];

  return async function buscarUsuarioPorCorreo(email, { use, name } = {}) {
    // email ya viene en minúsculas. `name` (claim del pase) se puede guardar al crear; aquí no se usa.
    let u = await consultar(email);
    if (!u && use === 'login') {
      // Alta solo en el ingreso. Atómica: logins concurrentes del mismo correo crean una sola fila.
      await db.query(
        "INSERT INTO usuarios (email, rol, activo) VALUES ($1, 'lector', true) ON CONFLICT (lower(email)) DO NOTHING",
        [email],
      );
      u = await consultar(email); // volver a consultar: la fila puede ser de otro login concurrente
    }
    if (!u) return null;
    return { id: String(u.id), rol: u.rol, activo: u.activo === true };
  };
}
