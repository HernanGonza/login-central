// Limitador de pedidos por clave en memoria (ventana fija). Por instancia: protege de ráfagas baratas
// (ALTCHA, /api/entrar); el límite de intentos de ingreso, que sí importa, vive en Postgres.
export function crearLimitadorPedidos({ max, ventanaMs = 60_000, ahora = () => Date.now() }) {
  const cubos = new Map();
  return {
    /** Cuenta un pedido. Devuelve { permitido, reintentarSeg }. */
    golpe(clave) {
      const t = ahora();
      if (cubos.size > 10_000) for (const [k, c] of cubos) if (c.fin <= t) cubos.delete(k);
      let c = cubos.get(clave);
      if (!c || c.fin <= t) { c = { n: 0, fin: t + ventanaMs }; cubos.set(clave, c); }
      c.n += 1;
      return c.n <= max
        ? { permitido: true, reintentarSeg: 0 }
        : { permitido: false, reintentarSeg: Math.max(1, Math.ceil((c.fin - t) / 1000)) };
    },
  };
}
