import { useCallback, useEffect, useRef, useState } from 'react';
import Logo from './Logo.jsx';
import Icono from './Iconos.jsx';
import misiones from './assets/misiones-gobierno.svg';

const TIMEOUT_CLIENTE = 5000; // el servidor ya corta a 3 s; esto es solo una red de seguridad

const conTimeout = (p) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_CLIENTE))]);

// Estados de tarjeta del servidor: disponible | consultando | sin_acceso (se oculta) | no_disponible (gris).
export default function Botonera({ api, sesion, enviar, onSalir }) {
  const [tarjetas, setTarjetas] = useState(null); // lista en el orden del servidor
  const [pendientes, setPendientes] = useState(0);
  const [error, setError] = useState(null);
  const volverHecho = useRef(false);
  const ronda = useRef(0); // descarta respuestas de una ronda anterior (Actualizar)

  // Lanza una consulta por tarjeta; cada una se pinta al responder.
  const consultar = useCallback((lista, forzar) => {
    const mia = ++ronda.current;
    const aConsultar = lista.filter((t) => forzar || t.pendiente);
    setPendientes(aConsultar.length);
    aConsultar.forEach(async (t) => {
      let nueva;
      try {
        const r = await conTimeout(api.estado(t.id, forzar));
        if (r.ok && r.data?.tarjeta) nueva = r.data.tarjeta;
      } catch { /* cae al estado de falla */ }
      if (mia !== ronda.current) return;
      // Falla: las siempre_visible siguen disponibles (sin rol); el resto queda gris.
      if (!nueva) nueva = { ...t, estado: t.siempre_visible ? 'disponible' : 'no_disponible', rol: null, pendiente: false };
      setTarjetas((prev) => prev.map((x) => (x.id === t.id ? nueva : x)));
      setPendientes((n) => n - 1);
    });
  }, [api]);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await api.tarjetas();
      if (!r.ok || !Array.isArray(r.data?.tarjetas)) return setError('No pudimos cargar tus sistemas.');
      setTarjetas(r.data.tarjetas);
      consultar(r.data.tarjetas, false);
    } catch {
      setError('No pudimos cargar tus sistemas.');
    }
  }, [api, consultar]);

  useEffect(() => { cargar(); }, [cargar]);

  // nueva=true (clic del usuario): cada sistema se abre en su propia pestaña y la botonera queda abierta.
  // La pestaña se abre ANTES del await (si no, el navegador la toma por ventana emergente y la bloquea).
  // Nombre fijo por sistema: un segundo clic reutiliza su pestaña. Sin opener: el sistema no controla al portal.
  // `?volver` (nueva=false) no es un clic: se queda en la misma pestaña.
  const abrir = useCallback(async (id, nueva = false) => {
    setError(null);
    const destino = nueva ? `sso-${id}` : undefined;
    let ventana = null;
    if (destino) {
      try { ventana = window.open('', destino); if (ventana) ventana.opener = null; } catch { ventana = null; }
    }
    const fallo = () => { try { ventana?.close(); } catch { /* nada */ } setError('No pudimos abrir el sistema. Probá de nuevo.'); };
    try {
      const r = await api.entrar(id);
      if (!r.ok || !r.data?.token) return fallo();
      // Si el navegador bloqueó la pestaña, se abre en la actual (como antes).
      if (ventana) enviar(r.data.url_login, r.data.token, destino);
      else enviar(r.data.url_login, r.data.token);
    } catch {
      fallo();
    }
  }, [api, enviar]);

  // `sesion.volver` ya viene validado por el servidor (id activo); aun así solo se abre si está en la lista
  // y disponible. Un sistema sin acceso/no disponible no se abre (y su enlace "sin acceso" no trae ?volver: sin bucles).
  useEffect(() => {
    const volver = sesion.volver;
    if (!volver || volverHecho.current || !tarjetas) return;
    const t = tarjetas.find((x) => x.id === volver);
    if (t && t.estado === 'disponible') {
      volverHecho.current = true;
      abrir(t.id);
    }
  }, [sesion.volver, tarjetas, abrir]);

  const visibles = (tarjetas || []).filter((t) => t.estado === 'disponible' || t.estado === 'no_disponible');
  const nombre = sesion.empleado?.nombre;

  return (
    <div className="botonera-pagina">
    <main className="botonera">
      <header className="cabecera">
        <Logo className="logo-cabecera" />
        <div className="acciones">
          <button type="button" className="secundario" onClick={() => tarjetas && consultar(tarjetas, true)} disabled={pendientes > 0}>Actualizar</button>
          <button type="button" className="secundario" onClick={onSalir}>Cerrar sesión</button>
        </div>
      </header>
      <div className="saludo">
        <h1>Hola, {nombre}</h1>
        <p className="sub">Estos son tus sistemas</p>
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {!tarjetas && !error && <p role="status" className="sub">Cargando…</p>}

      <ul className="grilla">
        {visibles.map((t) => {
          const gris = t.estado === 'no_disponible';
          const titulo = t.rol ? `${t.nombre} · ${t.rol}` : t.nombre;
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`tarjeta${gris ? ' gris' : ''}`}
                disabled={gris}
                onClick={() => abrir(t.id, true)}
              >
                <Icono icono={t.icono} />
                <span className="nombre">{titulo}</span>
                <span className="desc">{t.descripcion}</span>
                {gris && <span className="nodisp">No disponible</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {pendientes > 0 && <p className="buscando" role="status">Buscando más sistemas…</p>}
    </main>
    <footer className="pie">
      <img src={misiones} alt="Misiones, Gobierno de la Provincia" className="pie-misiones" />
    </footer>
    </div>
  );
}
