// Registro mínimo. Nunca recibe pases, claves ni secretos: además se redactan por nombre y por forma.
const PROHIBIDOS = /(token|pase|clave|password|secret|authorization|cookie|private|altcha|hash)/i;
const FORMA_JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

function limpiar(valor) {
  if (valor instanceof Error) valor = valor.name; // nunca el mensaje: puede traer fragmentos del cuerpo
  if (typeof valor === 'string') return valor.replace(FORMA_JWT, '[pase-redactado]');
  return valor;
}

export function redactar(campos = {}) {
  const salida = {};
  for (const [k, v] of Object.entries(campos)) {
    salida[k] = PROHIBIDOS.test(k) ? '[redactado]' : limpiar(v);
  }
  return salida;
}

export function crearLog(escribir = (linea) => console.log(linea)) {
  return (evento, campos) => {
    escribir(JSON.stringify({ t: new Date().toISOString(), evento, ...redactar(campos) }));
  };
}
