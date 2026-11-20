import { readFileSync } from 'node:fs';
import { leerArgs, ejecutar } from './util.js';
import { cargarSistemas } from '../sistemas.js';
import { migrar } from '../db.js';
import { ErrorUso } from '../usuarios.js';

const AYUDA = `Uso: npm run sistemas:cargar -- ruta.json

Upsert en sso_sistemas desde un JSON: [{id, nombre, descripcion, icono, url_login, url_acceso, siempre_visible, activo}].
url_login/url_acceso deben ser http(s); en producción (NODE_ENV distinto de development) solo https.
Todo o nada: si un elemento es inválido no se carga ninguno.`;
const args = leerArgs({}, { allowPositionals: true });
await ejecutar(AYUDA, args, async ({ config, pool }) => {
  if (args.positionals.length !== 1) throw new ErrorUso('indicá la ruta del JSON (ver --help)');
  let lista;
  try { lista = JSON.parse(readFileSync(args.positionals[0], 'utf8')); } catch { throw new ErrorUso('no se pudo leer el archivo o no es JSON válido'); }
  await migrar(pool);
  const ids = await cargarSistemas(pool, lista, { produccion: config.produccion });
  console.log(`sistemas cargados: ${ids.join(', ')}`);
});
