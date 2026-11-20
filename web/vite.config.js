import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api -> servidor del portal (server/ escucha en PORT, 3000 por defecto). Con el mock: API_URL=http://127.0.0.1:4000
// VITE_BASE: '/' (desarrollo, subdominio propio) o '/portal/' (bajo ecodatos). Siempre con barra final.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { proxy: { '/api': process.env.API_URL || 'http://127.0.0.1:3000' } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.js'],
  },
});
