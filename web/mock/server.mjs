import http from 'node:http';
import { handle, nuevoEstado } from './handler.js';

const estado = nuevoEstado();
const puerto = Number(process.env.MOCK_PORT || 4000);

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let cuerpo = null;
      try { cuerpo = raw ? JSON.parse(raw) : null; } catch { /* ignorar */ }
      const ruta = req.url;
      const pathname = new URL(req.url, 'http://x').pathname;
      const demora = /\/estado$/.test(pathname) ? 400 + Math.random() * 1500 : 0; // simula respuesta progresiva
      setTimeout(() => {
        const r = handle(req.method, ruta, cuerpo, estado);
        res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...r.headers });
        res.end(r.body === null ? undefined : JSON.stringify(r.body));
      }, demora);
    });
  })
  .listen(puerto, '127.0.0.1', () => console.log(`mock emisor en http://127.0.0.1:${puerto} (clave: clave-prueba)`));
