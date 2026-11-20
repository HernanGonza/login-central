// Migra y siembra datos de PRUEBA (portal + Personal de prueba). Nunca contra producción.
import { leerConfig } from './config.js';
import { crearPool, migrar, sembrarSistemas } from './db.js';
import { migrarPersonalPrueba, sembrarPersonalPrueba } from './personal/prueba.js';

const config = leerConfig();
if (!config.desarrollo) throw new Error('seed de prueba: solo con NODE_ENV=development explícito');
const pool = crearPool(config.databaseUrl);
await migrar(pool);
await sembrarSistemas(pool);
await migrarPersonalPrueba(pool);
await sembrarPersonalPrueba(pool);
await pool.end();
console.log('migración y semillas de prueba aplicadas');
