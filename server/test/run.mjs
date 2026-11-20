// Lanza las pruebas. Si no hay TEST_DATABASE_URL levanta un Postgres temporal propio (initdb en /tmp,
// solo socket unix, sin red) y lo destruye al terminar. No toca ninguna base existente.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let url = process.env.TEST_DATABASE_URL;
let dir = null;
let bin = '';

function buscarBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const r = spawnSync('which', ['initdb']);
  if (r.status === 0) return dirname(r.stdout.toString().trim());
  for (const base of ['/usr/lib/postgresql']) {
    if (!existsSync(base)) continue;
    for (const v of readdirSync(base).sort().reverse()) if (existsSync(join(base, v, 'bin', 'initdb'))) return join(base, v, 'bin');
  }
  throw new Error('No encuentro initdb. Definí PG_BIN o TEST_DATABASE_URL.');
}

if (!url) {
  bin = buscarBin();
  dir = mkdtempSync(join(tmpdir(), 'sso-pg-'));
  const ejec = (c, a) => {
    const r = spawnSync(join(bin, c), a, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${c} falló: ${r.stderr}`);
  };
  ejec('initdb', ['-D', join(dir, 'datos'), '-A', 'trust', '-U', 'prueba', '--no-sync']);
  ejec('pg_ctl', ['-D', join(dir, 'datos'), '-w', '-l', join(dir, 'pg.log'),
    '-o', `-c listen_addresses='' -k ${dir} -c fsync=off`, 'start']);
  url = `postgres://prueba@/postgres?host=${encodeURIComponent(dir)}`;
}

const hijo = spawn(process.execPath, ['--test', '--test-concurrency=1', ...process.argv.slice(2), 'test/*.test.js'], {
  cwd: raiz, stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url },
});
hijo.on('exit', (codigo) => {
  if (dir) {
    spawnSync(join(bin, 'pg_ctl'), ['-D', join(dir, 'datos'), '-m', 'immediate', 'stop']);
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(codigo ?? 1);
});
