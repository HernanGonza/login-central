import { Flor } from './Logo.jsx';

// Íconos de línea en el verde institucional (currentColor) para los nombres que manda el servidor.
const TRAZOS = {
  users: (<><circle cx="9" cy="8" r="3.2" /><path d="M2.8 19c.4-3.4 3-5.2 6.2-5.2s5.8 1.8 6.2 5.2" /><circle cx="17" cy="9" r="2.5" /><path d="M17.2 13.9c2.3.2 3.9 1.7 4.2 4.1" /></>),
  book: (<><path d="M4 5.5C6.8 4.6 9.6 4.8 12 6.5c2.4-1.7 5.2-1.9 8-1v13c-2.8-.9-5.6-.7-8 1-2.4-1.7-5.2-1.9-8-1z" /><path d="M12 6.5V19.5" /></>),
  fish: (<><path d="M3 12c3-4.5 8-5.5 12-3l3.5-2.5v11L15 15c-4 2.5-9 1.5-12-3z" /><circle cx="8.5" cy="11" r=".8" fill="currentColor" /></>),
};

// Si el servidor manda una URL se muestra como imagen; si no se conoce el nombre, se usa la flor del Lapacho.
export default function Icono({ icono }) {
  if (icono && /^(https?:\/\/|\/)/.test(icono)) return <img src={icono} alt="" className="icono" />;
  const t = TRAZOS[icono];
  if (!t) return <Flor className="icono icono-flor" aria-hidden="true" />;
  return (
    <svg className="icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{t}</svg>
  );
}
