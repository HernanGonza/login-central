// Utilidades comunes de los scripts de operación. Nunca imprimen secretos.
import { parseArgs } from 'node:util';
import { leerConfig } from '../config.js';
import { crearPool } from '../db.js';
import { ErrorUso } from '../usuarios.js';

export function leerArgs(opciones, { allowPositionals = false } = {}) {
  try {
    return parseArgs({ args: process.argv.slice(2), options: { help: { type: 'boolean', short: 'h' }, ...opciones }, allowPositionals });
  } catch (e) {
    throw new ErrorUso(e.message.split('\n')[0]);
  }
}

/** Ejecuta `fn({config,pool})` con el pool/config del portal; errores de uso -> mensaje y código 1. */
export async function ejecutar(ayuda, args, fn) {
  if (args.values.help) { console.log(ayuda); return; }
  let pool;
  try {
    let config;
    try { config = leerConfig(process.env); } catch (e) { throw new ErrorUso(e.message); } // mensajes de config: sin valores
    pool = crearPool(config.databaseUrl);
    await fn({ config, pool });
  } catch (e) {
    // Solo mensajes propios; de errores ajenos (red, SQL) únicamente tipo/código: pueden traer datos de conexión.
    console.error(`error: ${e instanceof ErrorUso ? e.message : `${e?.name ?? 'Error'}${e?.code ? ` (${e.code})` : ''}`}`);
    process.exitCode = 1;
  } finally {
    await pool?.end().catch(() => {});
  }
}

/** Lee todo stdin (sin TTY). Quita un único salto de línea final. */
export async function leerStdin() {
  const partes = [];
  for await (const c of process.stdin) partes.push(c);
  return Buffer.concat(partes).toString('utf8').replace(/\r?\n$/, '');
}

/** Pide un valor por la terminal sin eco. */
export function pedirOculto(pregunta) {
  return new Promise((ok, mal) => {
    const { stdin, stderr } = process;
    stderr.write(pregunta);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const fin = () => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', alDato); stderr.write('\n'); };
    const alDato = (d) => {
      for (const ch of d) {
        if (ch === '\r' || ch === '\n') { fin(); return ok(buf); }
        if (ch === '\u0003') { fin(); return mal(new ErrorUso('cancelado')); }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1); else buf += ch;
      }
    };
    stdin.on('data', alDato);
  });
}
