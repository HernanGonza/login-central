// Límite de intentos por correo y por IP, persistido en Postgres (sobrevive a reinicios y a varias instancias).
// El intento se RESERVA antes de verificar la clave: conteo + inserción de la fila 'pendiente' ocurren en una
// sola transacción bajo advisory locks (uno por correo y otro por IP), así N pedidos concurrentes no pueden
// pasar todos el conteo. Tras verificar, la fila se marca ok/fallida. Si el proceso muere a mitad, la fila
// queda pendiente y cuenta como fallo (falla cerrado).
export function crearLimites({ pool, config, ahora = () => new Date() }) {
  const { ventanaSeg, porPar, porCorreo, porIp, confianzaDias = 30 } = config.limites;
  return {
    /** Devuelve { permitido, reintentarSeg, id }. `id` (si permitido) se pasa luego a `resolver`. */
    async reservar(correo, ip) {
      const cli = await pool.connect();
      try {
        await cli.query('BEGIN');
        // Orden fijo de locks (correo, IP, par) para evitar interbloqueos.
        await cli.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`correo:${correo}`]);
        await cli.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ip:${ip}`]);
        await cli.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`par:${correo}|${ip}`]);
        const desde = new Date(ahora().getTime() - ventanaSeg * 1000);
        const q = async (where, vals) => {
          const { rows } = await cli.query(
            `SELECT count(*)::int AS n, min(creado) AS primero FROM intentos_ingreso
              WHERE ${where} AND ok = false AND creado > $1`, [desde, ...vals]);
          return rows[0];
        };
        const par = await q('correo = $2 AND ip = $3', [correo, ip]);
        const c = await q('correo = $2', [correo]);
        const i = await q('ip = $2', [ip]);
        const excede = [];
        if (par.n >= porPar) excede.push(par.primero);
        if (c.n >= porCorreo) {
          // El tope global no bloquea a una IP que ya ingresó bien con este correo (ver README: trade-off).
          const { rows: conf } = await cli.query(
            `SELECT 1 FROM intentos_ingreso WHERE correo = $1 AND ip = $2 AND ok = true AND pendiente = false
               AND creado > $3 LIMIT 1`,
            [correo, ip, new Date(ahora().getTime() - confianzaDias * 86_400_000)]);
          if (!conf.length) excede.push(c.primero);
        }
        if (i.n >= porIp) excede.push(i.primero);
        if (excede.length) {
          await cli.query('COMMIT');
          const libera = Math.max(...excede.map((p) => new Date(p).getTime() + ventanaSeg * 1000));
          return { permitido: false, reintentarSeg: Math.max(1, Math.ceil((libera - ahora().getTime()) / 1000)) };
        }
        const { rows } = await cli.query(
          `INSERT INTO intentos_ingreso (correo, ip, ok, pendiente, creado) VALUES ($1,$2,false,true,$3) RETURNING id`,
          [correo, ip, ahora()]);
        await cli.query('COMMIT');
        return { permitido: true, reintentarSeg: 0, id: rows[0].id };
      } catch (e) {
        await cli.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        cli.release();
      }
    },
    /** Marca el intento reservado como exitoso (borra los fallos previos del par correo+IP) o fallido. */
    async resolver(id, correo, ip, ok) {
      await pool.query('UPDATE intentos_ingreso SET ok = $2, pendiente = false WHERE id = $1', [id, !!ok]);
      if (ok) {
        await pool.query('DELETE FROM intentos_ingreso WHERE correo = $1 AND ip = $2 AND ok = false AND pendiente = false', [correo, ip]);
      }
    },
  };
}
