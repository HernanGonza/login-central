import { useEffect, useState } from 'react';
import { api as apiReal, enviarPost } from './api.js';
import Ingreso from './Ingreso.jsx';
import Botonera from './Botonera.jsx';

export default function App({ api = apiReal, enviar = enviarPost, volver }) {
  const [sesion, setSesion] = useState(undefined); // undefined = cargando, null = sin sesión
  const [config, setConfig] = useState(null);
  // Valor crudo de la URL: solo sirve para pedirle al servidor que lo valide (ignora lo que no sea un id activo).
  const volverCrudo = volver ?? new URLSearchParams(window.location.search).get('volver');

  useEffect(() => {
    api.config().then((r) => r.ok && setConfig(r.data)).catch(() => {});
    api.sesion(volverCrudo).then((r) => setSesion(r.ok ? r.data : null)).catch(() => setSesion(null));
  }, [api, volverCrudo]);

  async function alIngresar() {
    const r = await api.sesion(volverCrudo);
    if (r.ok) setSesion(r.data);
  }

  async function salir() {
    await api.salir().catch(() => {});
    setSesion(null);
  }

  // Franja discreta si el servidor declara entorno de prueba (adaptador de Personal de prueba).
  const aviso = config?.modo_prueba === true
    ? <div className="aviso-prueba" role="status">Entorno de prueba</div>
    : null;

  let contenido;
  if (sesion === undefined) contenido = <p className="cargando">Cargando…</p>;
  else if (!sesion) contenido = <Ingreso api={api} config={config} volver={volverCrudo} onIngreso={alIngresar} />;
  else contenido = <Botonera api={api} sesion={sesion} enviar={enviar} onSalir={salir} />;
  return <>{aviso}{contenido}</>;
}
