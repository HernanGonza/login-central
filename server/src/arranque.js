import { migrar, sembrarSistemas } from './db.js';
import { crearPersonal } from './personal/index.js';

/**
 * Prepara la base y el adaptador de Personal al arrancar.
 * - Siempre migra la base del portal (idempotente).
 * - Semillas de demo solo con NODE_ENV=development; con el adaptador de PRUEBA en producción
 *   (PORTAL_PERMITIR_ADAPTADOR_PRUEBA=1) NO se siembra nada: los datos se cargan con los scripts usuarios:* / sistemas:*.
 * - Con el adaptador de prueba crea la tabla `empleados` si no existe.
 */
export async function prepararArranque({ config, pool, log, aviso = (t) => console.warn(t) }) {
  await migrar(pool);
  if (config.desarrollo) await sembrarSistemas(pool);
  const personal = crearPersonal(config, pool);
  if (config.personal.adaptador === 'prueba') await personal.migrar();
  if (config.modoPrueba) {
    log('aviso_modo_prueba', {
      aviso: 'PORTAL EN MODO PRUEBA: Personal es una tabla de PRUEBA (empleados), no la base real. Sin semillas de demo.',
    });
    aviso([
      '',
      '################################################################',
      '#  ATENCION: MODO PRUEBA EN PRODUCCION                         #',
      '#  PERSONAL_ADAPTER=prueba (tabla `empleados` del portal).     #',
      '#  No es la base real de Personal. Reemplazar el adaptador.    #',
      '################################################################',
      '',
    ].join('\n'));
  }
  return personal;
}
