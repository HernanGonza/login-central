import { leerArgs, ejecutar } from './util.js';
import { listarUsuarios } from '../usuarios.js';
import { migrarPersonalPrueba } from '../personal/prueba.js';

const AYUDA = `Uso: npm run usuarios:listar

Lista los usuarios (id, correo, nombre, apellido, activo). Nunca muestra hashes.`;
const args = leerArgs({});
await ejecutar(AYUDA, args, async ({ pool }) => {
  await migrarPersonalPrueba(pool);
  const filas = await listarUsuarios(pool);
  if (!filas.length) return console.log('(sin usuarios)');
  for (const u of filas) console.log([u.id, u.email, `${u.nombre} ${u.apellido}`, u.activo ? 'activo' : 'INACTIVO'].join('\t'));
});
