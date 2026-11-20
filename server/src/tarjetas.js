// Botonera: lista inmediata + consulta de acceso por sistema (GET url_acceso con Bearer use=acceso).
// Estados de tarjeta: disponible | consultando | sin_acceso | no_disponible
/** https siempre; http solo en desarrollo o hacia localhost. Descarta javascript:, data:, etc. */
export function urlPermitida(u, desarrollo = false) {
  try {
    const { protocol, hostname } = new URL(u);
    if (protocol === 'https:') return true;
    if (protocol !== 'http:') return false;
    return desarrollo || ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch { return false; }
}

/** Filtra filas con URL inválida (no rompe al resto); registra solo el id. */
function validas(rows, desarrollo, log) {
  return rows.filter((s) => {
    const ok = urlPermitida(s.url_login, desarrollo) && urlPermitida(s.url_acceso, desarrollo);
    if (!ok) log?.('sistema_url_invalida', { sistema: s.id });
    return ok;
  });
}

export async function sistemasActivos(pool, { desarrollo = false, log } = {}) {
  const { rows } = await pool.query('SELECT * FROM sso_sistemas WHERE activo = true ORDER BY siempre_visible DESC, nombre');
  return validas(rows, desarrollo, log);
}

export async function sistemaActivo(pool, id, { desarrollo = false, log } = {}) {
  if (typeof id !== 'string' || id.length > 64) return null;
  const { rows } = await pool.query('SELECT * FROM sso_sistemas WHERE id = $1 AND activo = true', [id]);
  return validas(rows, desarrollo, log)[0] ?? null;
}

/** `volver` solo vale si es un id presente y activo en sso_sistemas; si no, se ignora (null). */
export async function validarVolver(pool, volver, opts) {
  const s = await sistemaActivo(pool, volver, opts);
  return s ? s.id : null;
}

export function crearTarjetas({ pool, sesiones, emisor, config, log, fetchImpl = fetch, ahora = () => Date.now() }) {
  const opts = { desarrollo: config.desarrollo, log };
  const frescura = config.tarjetas.cacheSeg * 1000;
  const fresca = (e) => e && typeof e.ts === 'number' && ahora() - e.ts < frescura;

  function vista(s, entrada) {
    const base = {
      id: s.id, nombre: s.nombre, descripcion: s.descripcion, icono: s.icono,
      siempre_visible: s.siempre_visible, rol: null,
    };
    if (!fresca(entrada)) {
      return { ...base, estado: s.siempre_visible ? 'disponible' : 'consultando', pendiente: true };
    }
    if (entrada.estado === 'no_disponible') {
      return { ...base, estado: s.siempre_visible ? 'disponible' : 'no_disponible', pendiente: false };
    }
    if (entrada.estado === 'sin_acceso') {
      return { ...base, estado: s.siempre_visible ? 'disponible' : 'sin_acceso', pendiente: false };
    }
    return { ...base, estado: 'disponible', rol: entrada.rol ?? null, pendiente: false };
  }

  async function consultarRemoto(s, sesion) {
    const entrada = { ts: ahora() };
    try {
      const pase = await emisor.emitir({
        empleado: { id: sesion.empleado_id, email: sesion.email, nombre: sesion.nombre, apellido: '' },
        aud: s.id, use: 'acceso',
      });
      const r = await fetchImpl(s.url_acceso, {
        headers: { Authorization: `Bearer ${pase}`, Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(config.tarjetas.timeoutMs),
      });
      if (r.status !== 200) throw new Error(`http ${r.status}`);
      const j = await r.json();
      if (typeof j?.acceso !== 'boolean') throw new Error('respuesta inválida');
      if (j.acceso) {
        entrada.estado = 'disponible';
        if (typeof j.rol === 'string' && j.rol.length <= 40) entrada.rol = j.rol;
      } else {
        entrada.estado = 'sin_acceso';
      }
    } catch (e) {
      entrada.estado = 'no_disponible';
      log('tarjeta_consulta_fallo', { sistema: s.id, motivo: e?.name === 'TimeoutError' ? 'timeout' : 'error' });
    }
    return entrada;
  }

  return {
    async listar(sesion, { forzar = false } = {}) {
      const sistemas = await sistemasActivos(pool, opts);
      const cache = forzar ? {} : sesion.cache ?? {};
      if (forzar) await sesiones.guardarCache(sesion.idHash, {});
      return sistemas.map((s) => vista(s, cache[s.id]));
    },

    /** Consulta un sistema (usa caché de 10 min salvo `forzar`). */
    async consultar(sesion, s, { forzar = false } = {}) {
      const previa = sesion.cache?.[s.id];
      if (!forzar && fresca(previa)) return vista(s, previa);
      const entrada = await consultarRemoto(s, sesion);
      await sesiones.ponerEnCache(sesion.idHash, s.id, entrada);
      return vista(s, entrada);
    },

    /** Todas en paralelo; cada una con su timeout de 3 s. */
    async consultarTodas(sesion, { forzar = false } = {}) {
      const sistemas = await sistemasActivos(pool, opts);
      return Promise.all(sistemas.map((s) => this.consultar(sesion, s, { forzar })));
    },
  };
}
