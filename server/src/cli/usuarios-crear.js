import { leerArgs, ejecutar, leerStdin, pedirOculto } from './util.js';
import { crearUsuario, generarClave, ErrorUso } from '../usuarios.js';
import { migrarPersonalPrueba } from '../personal/prueba.js';

const AYUDA = `Uso: npm run usuarios:crear -- --email X --nombre N --apellido A [--generar | --clave-stdin]

Crea un usuario en la tabla \`empleados\` (adaptador de PRUEBA). Hash argon2id.
  --email       Correo (se normaliza a minúsculas). Rechaza duplicados.
  --nombre      Nombre.
  --apellido    Apellido.
  --generar     Genera una clave aleatoria y la imprime UNA sola vez (nunca se registra).
  --clave-stdin Lee la clave desde la entrada estándar (p. ej. printf '%s' "$CLAVE" | npm run ...).
  (sin ambas)   Pide la clave por la terminal sin eco (con confirmación).
  -h, --help    Muestra esta ayuda.`;

const args = leerArgs({
  email: { type: 'string' }, nombre: { type: 'string' }, apellido: { type: 'string' },
  generar: { type: 'boolean' }, 'clave-stdin': { type: 'boolean' },
});
await ejecutar(AYUDA, args, async ({ config, pool }) => {
  const v = args.values;
  if (!v.email || !v.nombre || !v.apellido) throw new ErrorUso('faltan --email, --nombre o --apellido (ver --help)');
  if (v.generar && v['clave-stdin']) throw new ErrorUso('--generar y --clave-stdin son excluyentes');
  if (config.personal.adaptador !== 'prueba') throw new ErrorUso("solo aplica con PERSONAL_ADAPTER=prueba");
  let clave;
  if (v.generar) clave = generarClave();
  else if (v['clave-stdin'] || !process.stdin.isTTY) clave = await leerStdin();
  else {
    clave = await pedirOculto('Clave: ');
    if (clave !== await pedirOculto('Repetir clave: ')) throw new ErrorUso('las claves no coinciden');
  }
  await migrarPersonalPrueba(pool);
  const u = await crearUsuario(pool, { email: v.email, nombre: v.nombre, apellido: v.apellido, clave });
  console.log(`usuario creado: ${u.email} (id ${u.id})`);
  if (v.generar) console.log(`clave generada (se muestra una sola vez): ${clave}`);
});
