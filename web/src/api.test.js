import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, enviarPost } from './api.js';

describe('enviarPost', () => {
  it('arma un formulario POST oculto con el token en el cuerpo, no en la URL', () => {
    let enviado;
    HTMLFormElement.prototype.submit = function () { enviado = this; };
    enviarPost('https://wiki.example/sso/login', 'abc.def.ghi');
    expect(enviado.method).toBe('post');
    expect(enviado.action).toBe('https://wiki.example/sso/login');
    expect(enviado.action).not.toContain('abc');
    expect(enviado.querySelector('input[name=token]').value).toBe('abc.def.ghi');
    expect(enviado.style.display).toBe('none');
  });
});

describe('enviarPost: esquema de url_login', () => {
  it('rechaza javascript:, data:, file:, relativas y vacías sin enviar', () => {
    let n = 0;
    HTMLFormElement.prototype.submit = function () { n++; };
    for (const u of ['javascript:alert(1)', 'JaVaScript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '/sso/login', '', undefined]) {
      expect(() => enviarPost(u, 't'), String(u)).toThrow();
    }
    expect(n).toBe(0);
    expect(() => enviarPost('http://localhost:4100/sso/login', 't')).not.toThrow();
    expect(n).toBe(1);
  });
});

describe('api: rutas y cuerpos del server real', () => {
  afterEach(() => vi.unstubAllGlobals());
  const falso = () => {
    const f = vi.fn(async () => ({ status: 200, ok: true, headers: new Headers(), json: async () => ({}) }));
    vi.stubGlobal('fetch', f);
    return f;
  };

  it('rutas, métodos y cuerpo JSON', async () => {
    const f = falso();
    await api.ingreso('a@b.c', 'k', 'sol', 'wiki');
    expect(f.mock.calls[0][0]).toBe('/api/ingreso');
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ email: 'a@b.c', clave: 'k', altcha: 'sol', volver: 'wiki' });
    await api.sesion('wiki'); expect(f.mock.calls[1][0]).toBe('/api/sesion?volver=wiki');
    await api.sesion(null); expect(f.mock.calls[2][0]).toBe('/api/sesion');
    await api.salir(); expect(f.mock.calls[3]).toEqual(['/api/salir', expect.objectContaining({ method: 'POST' })]);
    await api.tarjetas(); expect(f.mock.calls[4][0]).toBe('/api/tarjetas');
    await api.estado('x y', true); expect(f.mock.calls[5][0]).toBe('/api/tarjetas/x%20y/estado?forzar=1');
    await api.entrar('wiki'); expect(f.mock.calls[6]).toEqual(['/api/entrar/wiki', expect.objectContaining({ method: 'POST' })]);
  });

  it('expone Retry-After', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 429, ok: false, headers: new Headers({ 'Retry-After': '42' }), json: async () => ({}) })));
    expect((await api.ingreso('a', 'b', 'c')).retryAfter).toBe(42);
  });
});

describe('apiUrl', () => {
  it('antepone la base de la app sin duplicar barras', async () => {
    const { apiUrl } = await import('./api.js');
    expect(apiUrl('/api/config', '/')).toBe('/api/config');
    expect(apiUrl('/api/config', '/portal/')).toBe('/portal/api/config');
    expect(apiUrl('/api/altcha', '/portal')).toBe('/portal/api/altcha');
  });
});
