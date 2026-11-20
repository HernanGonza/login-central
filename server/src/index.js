import { leerConfig } from './config.js';
import { crearPool } from './db.js';
import { cargarClaves } from './claves.js';
import { prepararArranque } from './arranque.js';
import { crearLog } from './log.js';
import { crearApp } from './app.js';
import { purgar } from './purga.js';

const config = leerConfig();
const log = crearLog();
const pool = crearPool(config.databaseUrl);
const personal = await prepararArranque({ config, pool, log }); // migra; semillas solo en desarrollo
// En desarrollo, sin clave configurada se genera una efímera (nunca en producción).
const claves = await cargarClaves(config, { permitirEfimera: config.desarrollo });
if (!config.privateKey && !config.privateKeyPath) log('clave_efimera', { aviso: 'sin SSO_PRIVATE_KEY*; clave de desarrollo' });

const purga = () => purgar(pool, config).catch((e) => log('purga_fallo', { tipo: e?.name }));
await purga();
setInterval(purga, config.purgaSeg * 1000).unref();

crearApp({ config, pool, personal, claves, log }).listen(config.puerto, () => {
  log('escuchando', { puerto: config.puerto, kid: claves.kid });
});
