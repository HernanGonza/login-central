import { useCallback, useState } from 'react';
import Altcha from './Altcha.jsx';
import Logo from './Logo.jsx';

const CONTACTO = 'desarrollo@ecologia.misiones.gob.ar';

export default function Ingreso({ api, config, volver, onIngreso }) {
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [altcha, setAltcha] = useState('');
  const [error, setError] = useState(null); // 'no_encontrado' | 'duplicado' | 'credenciales' | 'captcha' | 'limite' | 'red'
  const [enviando, setEnviando] = useState(false);
  const [ronda, setRonda] = useState(0); // la solución ALTCHA es de un solo uso: tras cada envío se remonta el widget
  const [info, setInfo] = useState({});
  const alAltcha = useCallback((p) => setAltcha(p), []);

  async function enviar(e) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError('no_encontrado');
    if (!altcha) return setError('captcha');
    setEnviando(true);
    try {
      const r = await api.ingreso(email.trim().toLowerCase(), clave, altcha, volver);
      if (r.ok) return await onIngreso(r.data);
      const cod = r.data?.error;
      setInfo({
        registroUrl: r.data?.registroUrl,
        recuperoUrl: r.data?.recuperoUrl,
        espera: r.retryAfter || r.data?.reintentarSeg,
      });
      let e = 'red';
      if (r.status === 400) e = cod === 'correo_vacio' ? 'no_encontrado' : 'captcha';
      else if (r.status === 404) e = 'no_encontrado';
      else if (r.status === 409) e = 'duplicado';
      else if (r.status === 401) e = 'credenciales';
      else if (r.status === 429) e = 'limite';
      setError(e);
      setAltcha('');
      setRonda((n) => n + 1);
    } catch {
      setError('red');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="ingreso">
      <section className="panel-verde">
        <div className="patron" aria-hidden="true" />
        <p className="panel-ministerio">Ministerio de Ecología y Recursos Naturales Renovables</p>
        <h1>Todos los sistemas del Ministerio, con un solo ingreso.</h1>
      </section>
      <section className="panel-form">
        <Logo className="logo-ingreso" />
        <form onSubmit={enviar} noValidate>
          <h2>Ingresar</h2>
          <p className="sub">Con tu cuenta del Ministerio.</p>

          <label htmlFor="email">Correo</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />

          <label htmlFor="clave">Clave</label>
          <input id="clave" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />

          <Altcha key={ronda} onChange={alAltcha} />

          {error === 'no_encontrado' && (
            <p role="alert" className="error">
              No encontramos tu correo.{' '}
              {(info.registroUrl || config?.registroUrl) && (
                <a href={info.registroUrl || config.registroUrl}>Registrate acá</a>
              )}
            </p>
          )}
          {error === 'duplicado' && (
            <p role="alert" className="error">
              Tu correo figura más de una vez. Contactate con el equipo de desarrollo:{' '}
              <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>
            </p>
          )}
          {error === 'credenciales' && <p role="alert" className="error">Correo o clave incorrectos.</p>}
          {error === 'captcha' && <p role="alert" className="error">Completá la verificación de seguridad.</p>}
          {error === 'limite' && <p role="alert" className="error">Demasiados intentos. Probá de nuevo en {info.espera ? `${Math.ceil(info.espera / 60)} min` : 'unos minutos'}.</p>}
          {error === 'red' && <p role="alert" className="error">No pudimos conectar. Probá de nuevo.</p>}

          <button type="submit" className="primario" disabled={enviando}>Ingresar</button>
          {config?.recuperoUrl && (
            <p className="enlace"><a href={config.recuperoUrl}>Olvidé mi clave</a></p>
          )}
        </form>
      </section>
    </main>
  );
}
