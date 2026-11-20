// Purga periódica de tablas que solo crecen: sesiones vencidas, jti de auditoría, intentos viejos, ALTCHA usados.
export async function purgar(pool, config) {
  const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rowCount);
  return {
    sesiones: await q('DELETE FROM sso_sesiones WHERE expira < now()'),
    altcha: await q('DELETE FROM altcha_usados WHERE expira < now()'),
    // Los fallos solo cuentan dentro de la ventana (los pendientes también vencen). Los ingresos exitosos se
    // conservan `confianzaDias` (IPs de confianza para el tope global por correo).
    intentos: await q(`DELETE FROM intentos_ingreso
        WHERE (NOT (ok AND NOT pendiente) AND creado < now() - ($1 || ' seconds')::interval)
           OR creado < now() - ($2 || ' days')::interval`,
    [String(config.limites.ventanaSeg), String(config.limites.confianzaDias ?? 30)]),
    jti: await q("DELETE FROM jti_usados WHERE emitido < now() - ($1 || ' days')::interval",
      [String(config.jtiRetencionDias)]),
  };
}
