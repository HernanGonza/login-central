import { leerArgs, ejecutar } from './util.js';
import { listarSistemas } from '../sistemas.js';
import { migrar } from '../db.js';

const AYUDA = `Uso: npm run sistemas:listar

Lista los sistemas de sso_sistemas (id, activo, siempre_visible, url_login, url_acceso).`;
const args = leerArgs({});
await ejecutar(AYUDA, args, async ({ pool }) => {
  await migrar(pool);
  const filas = await listarSistemas(pool);
  if (!filas.length) return console.log('(sin sistemas)');
  for (const s of filas) console.log([s.id, s.activo ? 'activo' : 'INACTIVO', s.siempre_visible ? 'siempre_visible' : '-', s.url_login, s.url_acceso].join('\t'));
});
