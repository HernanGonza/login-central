import { leerArgs, ejecutar } from './util.js';
import { desactivarUsuario, ErrorUso } from '../usuarios.js';
import { migrarPersonalPrueba } from '../personal/prueba.js';

const AYUDA = `Uso: npm run usuarios:desactivar -- --email X

Marca el usuario como inactivo (no puede ingresar ni obtener pases). No borra datos.`;
const args = leerArgs({ email: { type: 'string' } });
await ejecutar(AYUDA, args, async ({ pool }) => {
  if (!args.values.email) throw new ErrorUso('falta --email (ver --help)');
  await migrarPersonalPrueba(pool);
  await desactivarUsuario(pool, args.values.email);
  console.log('usuario desactivado');
});
