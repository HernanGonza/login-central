import { isIP } from 'node:net';

/**
 * Clave de IP para los límites: IPv4 tal cual; IPv4 mapeada en IPv6 (::ffff:a.b.c.d) como IPv4;
 * IPv6 reducida a su /64 (un cliente suele controlar un /64 entero: si no, rotar direcciones esquivaría el límite).
 */
export function claveIp(ip) {
  if (typeof ip !== 'string' || !ip) return 'desconocida';
  const limpia = ip.split('%')[0].toLowerCase();
  const mapeada = limpia.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeada && isIP(mapeada[1]) === 4) return mapeada[1];
  if (isIP(limpia) === 4) return limpia;
  if (isIP(limpia) !== 6) return 'desconocida';
  let [izq, der] = limpia.split('::');
  const partes = (x) => (x ? x.split(':') : []);
  let g = partes(izq);
  if (der !== undefined) {
    const d = partes(der);
    g = [...g, ...Array(Math.max(0, 8 - g.length - d.length)).fill('0'), ...d];
  }
  if (g.length < 4) return 'desconocida';
  return `${g.slice(0, 4).map((x) => parseInt(x || '0', 16).toString(16)).join(':')}::/64`;
}
