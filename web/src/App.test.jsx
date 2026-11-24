import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { handle, nuevoEstado } from '../mock/handler.js';
import App from './App.jsx';

vi.mock('altcha', () => ({}));

// API falsa construida sobre el mock del emisor. `retardos`: id -> promesa que controla cuándo responde /estado.
// `consulta`: lo que responde cada sistema ({acceso, rol} | {acceso:false} | {falla:true}).
function crearApi({ retardos = {}, estado = nuevoEstado(), consulta = {} } = {}) {
  Object.assign(estado.consulta, consulta);
  const llamar = (m, r, b) => Promise.resolve(handle(m, r, b, estado)).then((x) => ({
    ...x, ok: x.status < 400, data: x.body, retryAfter: Number(x.headers?.['Retry-After']) || null,
  }));
  const qs = (forzar) => (forzar ? '?forzar=1' : '');
  const api = {
    config: () => llamar('GET', '/api/config'),
    sesion: vi.fn((v) => llamar('GET', `/api/sesion${v ? `?volver=${encodeURIComponent(v)}` : ''}`)),
    ingreso: vi.fn((e, c, a, v) => llamar('POST', '/api/ingreso', { email: e, clave: c, altcha: a, volver: v })),
    salir: () => llamar('POST', '/api/salir'),
    tarjetas: vi.fn((f) => llamar('GET', `/api/tarjetas${qs(f)}`)),
    estado: vi.fn(async (id, f) => {
      if (retardos[id]) await retardos[id];
      return llamar('GET', `/api/tarjetas/${id}/estado${qs(f)}`);
    }),
    entrar: vi.fn((id) => llamar('POST', `/api/entrar/${id}`)),
  };
  return { api, estado };
}

const conSesion = () => {
  const estado = nuevoEstado();
  estado.sesion = { id: 'e1', nombre: 'Ana', nombreCompleto: 'Ana Gómez', email: 'ana@ecologia.test' };
  return estado;
};

async function completarIngreso(email, clave = 'clave-prueba', conCaptcha = true) {
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: 'Ingresar' });
  await user.type(screen.getByLabelText('Correo'), email);
  await user.type(screen.getByLabelText('Clave'), clave);
  if (conCaptcha) {
    fireEvent(document.querySelector('altcha-widget'), new CustomEvent('statechange', { detail: { state: 'verified', payload: 'tok' } }));
  }
  await user.click(screen.getByRole('button', { name: 'Ingresar' }));
}

let abrirVentana;
beforeEach(() => {
  sessionStorage.clear();
  abrirVentana = vi.spyOn(window, 'open').mockImplementation(() => ({ opener: 'x', close: vi.fn() }));
});

describe('Ingreso', () => {
  it('muestra el texto del panel y el formulario', async () => {
    render(<App api={crearApi().api} />);
    expect(await screen.findByText('Todos los sistemas del Ministerio, con un solo ingreso.')).toBeInTheDocument();
    expect(screen.getByText('Con tu cuenta del Ministerio.')).toBeInTheDocument();
  });

  it('sin captcha no envía', async () => {
    const { api } = crearApi();
    render(<App api={api} />);
    await completarIngreso('ana@ecologia.test', 'clave-prueba', false);
    expect(await screen.findByRole('alert')).toHaveTextContent('verificación');
    expect(api.ingreso).not.toHaveBeenCalled();
  });

  it('correo no encontrado: mensaje y enlace al registro', async () => {
    render(<App api={crearApi().api} />);
    await completarIngreso('nadie@ecologia.test');
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('No encontramos tu correo');
    expect(screen.getByRole('link', { name: /Registrate/ })).toHaveAttribute('href', 'https://personal.example/registro');
  });

  it('correo vacío: mismo mensaje', async () => {
    const user = userEvent.setup();
    render(<App api={crearApi().api} />);
    await screen.findByRole('heading', { name: 'Ingresar' });
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos tu correo');
  });

  it('correo duplicado: mensaje de contacto', async () => {
    render(<App api={crearApi().api} />);
    await completarIngreso('doble@ecologia.test');
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('Tu correo figura más de una vez. Contactate con el equipo de desarrollo: desarrollo@ecologia.misiones.gob.ar');
  });

  it('clave incorrecta y límite de intentos', async () => {
    render(<App api={crearApi().api} />);
    await completarIngreso('ana@ecologia.test', 'mala');
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrectos');
  });

  it('ingreso correcto lleva a la botonera', async () => {
    render(<App api={crearApi().api} />);
    await completarIngreso('Ana@Ecologia.test');
    expect(await screen.findByText('Hola, Ana')).toBeInTheDocument();
    expect(screen.getByText('Estos son tus sistemas')).toBeInTheDocument();
  });
});

describe('Ingreso (contra el server real)', () => {
  it('envía volver y la solución altcha tal cual; tras un rechazo remonta el widget (un solo uso)', async () => {
    const { api } = crearApi();
    render(<App api={api} volver="wiki" />);
    const antes = document.querySelector('altcha-widget');
    await completarIngreso('ana@ecologia.test', 'mala');
    await screen.findByRole('alert');
    expect(api.ingreso).toHaveBeenCalledWith('ana@ecologia.test', 'mala', 'tok', 'wiki');
    expect(document.querySelector('altcha-widget')).not.toBe(antes);
  });

  it('429 informa la espera (Retry-After)', async () => {
    render(<App api={crearApi().api} />);
    await completarIngreso('bloqueado@ecologia.test');
    expect(await screen.findByRole('alert')).toHaveTextContent('10 min');
  });

  it('el widget apunta a /api/altcha', async () => {
    render(<App api={crearApi().api} />);
    await screen.findByRole('heading', { name: 'Ingresar' });
    expect(document.querySelector('altcha-widget')).toHaveAttribute('challengeurl', '/api/altcha');
  });
});

describe('Botonera', () => {
  it('siempre_visible al instante; el resto aparece al responder', async () => {
    let liberar;
    const { api } = crearApi({ estado: conSesion(), retardos: { pesca: new Promise((r) => (liberar = r)) } });
    render(<App api={api} />);
    expect(await screen.findByText('Personal')).toBeInTheDocument();
    expect(screen.queryByText('Pesca')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Buscando');
    liberar();
    expect(await screen.findByText('Pesca')).toBeInTheDocument();
  });

  it('muestra el rol en la tarjeta', async () => {
    render(<App api={crearApi({ estado: conSesion() }).api} />);
    expect(await screen.findByText('Wiki · administrador')).toBeInTheDocument();
  });

  it('sin_acceso oculta la tarjeta', async () => {
    const { api } = crearApi({ estado: conSesion(), consulta: { pesca: { acceso: false } } });
    render(<App api={api} />);
    await screen.findByText('Wiki · administrador');
    await waitFor(() => expect(api.estado).toHaveBeenCalledWith('pesca', false));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByText('Pesca')).not.toBeInTheDocument();
    expect(screen.queryByText('No disponible')).not.toBeInTheDocument();
  });

  it('tarjeta gris "no disponible" si falla la consulta, y no se puede abrir', async () => {
    const { api } = crearApi({ estado: conSesion(), consulta: { pesca: { falla: true } } });
    render(<App api={api} />);
    const t = (await screen.findByText('No disponible')).closest('button');
    expect(t).toBeDisabled();
    expect(t).toHaveClass('gris');
    expect(t).toHaveTextContent('Pesca');
  });

  it('una siempre_visible no se pone gris aunque falle la consulta', async () => {
    const { api } = crearApi({ estado: conSesion(), consulta: { wiki: { falla: true } } });
    render(<App api={api} />);
    await screen.findByText('Pesca');
    expect(screen.getByText('Wiki').closest('button')).not.toBeDisabled();
  });

  it('la caché es del servidor: con todo fresco no consulta; Actualizar fuerza todas', async () => {
    const estado = conSesion();
    const a1 = crearApi({ estado });
    const { unmount } = render(<App api={a1.api} />);
    await screen.findByText('Pesca');
    expect(a1.api.estado).toHaveBeenCalledTimes(3);
    unmount();

    const a2 = crearApi({ estado });
    render(<App api={a2.api} />);
    await screen.findByText('Pesca');
    expect(a2.api.estado).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(a2.api.estado).toHaveBeenCalledTimes(3));
    expect(a2.api.estado).toHaveBeenCalledWith('wiki', true);
  });

  it('tocar tarjeta pide el pase y lo envía por POST (no por URL)', async () => {
    const enviar = vi.fn();
    const { api } = crearApi({ estado: conSesion() });
    render(<App api={api} enviar={enviar} />);
    await userEvent.setup().click(await screen.findByText('Wiki · administrador'));
    await waitFor(() => expect(enviar).toHaveBeenCalledWith('https://wiki.example/sso/login', 'pase-wiki', 'sso-wiki'));
    expect(abrirVentana).toHaveBeenCalledWith('', 'sso-wiki');
    expect(abrirVentana.mock.results[0].value.opener).toBeNull();
    expect(window.location.href).not.toContain('pase-wiki');
  });

  it('si el navegador bloquea la pestaña nueva, abre en la actual', async () => {
    abrirVentana.mockImplementation(() => null);
    const enviar = vi.fn();
    const { api } = crearApi({ estado: conSesion() });
    render(<App api={api} enviar={enviar} />);
    await userEvent.setup().click(await screen.findByText('Wiki · administrador'));
    await waitFor(() => expect(enviar).toHaveBeenCalledWith('https://wiki.example/sso/login', 'pase-wiki'));
  });

  it('si falla entrar, cierra la pestaña en blanco y avisa', async () => {
    const ventana = { opener: 'x', close: vi.fn() };
    abrirVentana.mockImplementation(() => ventana);
    const enviar = vi.fn();
    const { api } = crearApi({ estado: conSesion() });
    api.entrar.mockRejectedValue(new Error('x'));
    render(<App api={api} enviar={enviar} />);
    await userEvent.setup().click(await screen.findByText('Wiki · administrador'));
    await screen.findByText(/No pudimos abrir el sistema/);
    expect(ventana.close).toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
  });

  it('?volver con id válido abre ese sistema una sola vez', async () => {
    const enviar = vi.fn();
    const { api } = crearApi({ estado: conSesion() });
    render(<App api={api} enviar={enviar} volver="wiki" />);
    await waitFor(() => expect(enviar).toHaveBeenCalledWith('https://wiki.example/sso/login', 'pase-wiki'));
    expect(abrirVentana).not.toHaveBeenCalled();
    await screen.findByText('Pesca');
    expect(api.entrar).toHaveBeenCalledTimes(1);
  });

  it('?volver a un sistema sin acceso no lo abre', async () => {
    const enviar = vi.fn();
    const { api } = crearApi({ estado: conSesion(), consulta: { pesca: { acceso: false } } });
    render(<App api={api} enviar={enviar} volver="pesca" />);
    await waitFor(() => expect(api.estado).toHaveBeenCalledWith('pesca', false));
    await screen.findByText('Wiki · administrador');
    expect(enviar).not.toHaveBeenCalled();
  });

  it('?volver con id desconocido se ignora', async () => {
    const enviar = vi.fn();
    const { api } = crearApi({ estado: conSesion() });
    render(<App api={api} enviar={enviar} volver="otro" />);
    await screen.findByText('Pesca');
    expect(api.entrar).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
  });

  it('?volver a un sistema no disponible no lo abre', async () => {
    const enviar = vi.fn();
    const { api } = crearApi({ estado: conSesion(), consulta: { pesca: { falla: true } } });
    render(<App api={api} enviar={enviar} volver="pesca" />);
    await screen.findByText('No disponible');
    expect(enviar).not.toHaveBeenCalled();
  });

  it('cerrar sesión vuelve al ingreso', async () => {
    render(<App api={crearApi({ estado: conSesion() }).api} />);
    await screen.findByText('Pesca');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Ingresar' })).toBeInTheDocument();
  });
});

describe('Aviso de entorno de prueba', () => {
  const conConfig = (cfg, estado) => {
    const { api } = crearApi({ estado });
    api.config = () => Promise.resolve({ status: 200, ok: true, data: cfg });
    return api;
  };

  it('con modo_prueba:true muestra la franja en el ingreso y con sesión', async () => {
    const { unmount } = render(<App api={conConfig({ modo_prueba: true })} />);
    expect(await screen.findByText('Entorno de prueba')).toBeInTheDocument();
    unmount();
    render(<App api={conConfig({ modo_prueba: true }, conSesion())} />);
    await screen.findByText('Pesca');
    expect(await screen.findByText('Entorno de prueba')).toBeInTheDocument();
  });

  it('sin modo_prueba (o false) no muestra la franja', async () => {
    render(<App api={conConfig({ modo_prueba: false })} />);
    await screen.findByRole('heading', { name: 'Ingresar' });
    expect(screen.queryByText('Entorno de prueba')).not.toBeInTheDocument();
  });

  it('si /api/config falla no muestra la franja ni rompe', async () => {
    const api = crearApi().api;
    api.config = () => Promise.reject(new Error('red'));
    render(<App api={api} />);
    await screen.findByRole('heading', { name: 'Ingresar' });
    expect(screen.queryByText('Entorno de prueba')).not.toBeInTheDocument();
  });
});
