// Único punto donde el portal toca Personal. Cambiar de base = cambiar solo este adaptador.
import pg from 'pg';
import { crearPersonalPrueba } from './prueba.js';

export function crearPersonal(config, poolPortal) {
  if (config.personal.adaptador === 'prueba') {
    if (!config.desarrollo && !config.modoPrueba) {
      throw new Error("PERSONAL_ADAPTER='prueba' solo se admite con NODE_ENV=development o PORTAL_PERMITIR_ADAPTADOR_PRUEBA=1");
    }
    const pool = config.personal.databaseUrl
      ? new pg.Pool({ connectionString: config.personal.databaseUrl, max: 5 })
      : poolPortal;
    return crearPersonalPrueba(pool);
  }
  throw new Error(`Adaptador de Personal desconocido: ${config.personal.adaptador}`);
}
