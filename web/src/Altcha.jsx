import { useEffect, useRef } from 'react';
import { apiUrl } from './api.js';

// Widget ALTCHA auto-alojado (paquete `altcha` 1.x = protocolo v1, igual que altcha-lib/v1 del servidor):
// pide el desafío a challengeUrl y entrega `payload` (base64 de {algorithm, challenge, number, salt, signature, took}),
// que el servidor espera tal cual en el campo `altcha`. Llama onChange(payload) al verificarse y onChange('') si se invalida.
// La solución es de un solo uso: para pedir otra hay que remontar el componente (cambiar su `key`).
// Textos del widget en español (el paquete los trae en inglés).
const TEXTOS = JSON.stringify({
  label: 'No soy un robot',
  verifying: 'Verificando…',
  verified: 'Verificado',
  error: 'No se pudo verificar. Intentá de nuevo más tarde.',
  expired: 'La verificación venció. Intentá de nuevo.',
  waitAlert: 'Verificando… esperá un momento.',
  ariaLinkLabel: 'Visitar ALTCHA.org',
  footer: '',
});

export default function Altcha({ onChange, challengeUrl = apiUrl('/api/altcha') }) {
  const ref = useRef(null);

  useEffect(() => {
    import('altcha').catch(() => {});
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const alCambiar = (e) => {
      const { state, payload } = e.detail || {};
      onChange(state === 'verified' && payload ? payload : '');
    };
    el.addEventListener('statechange', alCambiar);
    return () => el.removeEventListener('statechange', alCambiar);
  }, [onChange]);

  return <altcha-widget ref={ref} challengeurl={challengeUrl} strings={TEXTOS} hidefooter="" hidelogo="" />;
}
