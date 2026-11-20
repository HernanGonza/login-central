import flor from './assets/flor-lapacho.svg';

// Versión horizontal "símbolo + logotipo" del Brandbook 2024 (p. 9-10): flor del Lapacho a color y
// "ECOLOGÍA / MISIONES" en Oak Sans, verde institucional. Se escala solo con `--logo` (alto de la flor):
// nunca se deforma, recolorea ni gira. El área de seguridad (.logo padding) queda siempre incluida.
export function Flor({ className = 'flor', ...resto }) {
  return <img src={flor} alt="" className={className} {...resto} />;
}

export default function Logo({ className = '' }) {
  return (
    <span className={`logo ${className}`.trim()} role="img" aria-label="Ecología Misiones">
      <img src={flor} alt="" className="logo-flor" aria-hidden="true" />
      <span className="logo-texto" aria-hidden="true">
        <span className="logo-1">ECOLOGÍA</span>
        <span className="logo-2">MISIONES</span>
      </span>
    </span>
  );
}
