// Pruebas contra docs/sso/vectores. Correr: ver README.md
import { assertEquals } from "@std/assert";
import { createLocalJWKSet } from "jose";
import type { CompactVerifyGetKey } from "jose";
import { importPKCS8, SignJWT } from "jose";
import { validarJwksUrl, verificarPase } from "../functions/sso/verificar.ts";
import { crearHandler, type Usuario } from "../functions/sso/handler.ts";

const dir = Deno.env.get("VECTORES_DIR") ??
  new URL("../../../docs/sso/vectores/", import.meta.url).pathname;
const V = JSON.parse(await Deno.readTextFile(`${dir}/vectores.PRUEBA.json`));
const JWKS = JSON.parse(await Deno.readTextFile(`${dir}/${V.jwks}`));
const getKey = createLocalJWKSet(JWKS) as unknown as CompactVerifyGetKey;
const ahora = () => V.ahora as number;

const nuevoStore = () => {
  const usados = new Set<string>();
  return async (jti: string) => {
    if (usados.has(jti)) return false;
    usados.add(jti);
    return true;
  };
};
const opts = (use: "login" | "acceso", marcarJti = nuevoStore()) =>
  ({ use, iss: V.iss, aud: V.aud_esperada, getKey, ahora, marcarJti });

for (const [nombre, c] of Object.entries<any>(V.casos)) {
  if (nombre === "jti_repetido") continue;
  Deno.test(`verificar: ${nombre} -> ${c.esperado}`, async () => {
    const r = await verificarPase(c.token, opts(c.use_esperado));
    assertEquals(r.ok ? "ok" : r.motivo, c.esperado);
  });
}

Deno.test("verificar: jti_repetido (1a ok, 2a jti)", async () => {
  const c = V.casos.jti_repetido;
  const store = nuevoStore();
  const a = await verificarPase(c.token, opts("login", store));
  const b = await verificarPase(c.token, opts("login", store));
  assertEquals(a.ok, true);
  assertEquals(b.ok ? "ok" : b.motivo, "jti");
});

Deno.test("verificar: use=acceso no consume jti (se puede repetir)", async () => {
  const c = V.casos.valido_acceso;
  const store = nuevoStore();
  assertEquals((await verificarPase(c.token, opts("acceso", store))).ok, true);
  assertEquals((await verificarPase(c.token, opts("acceso", store))).ok, true);
});

// ---- endurecimiento (revision de seguridad) ----
const clavePriv = await importPKCS8(await Deno.readTextFile(`${dir}/clave-privada.PRUEBA.pem`), "RS256");
async function firmar(o: { iat?: number; exp?: number; aud?: unknown; sinIat?: boolean; extra?: Record<string, unknown> } = {}) {
  const iat = o.iat ?? V.ahora - 5;
  const j = new SignJWT({ email: "ana.perez@ecologia.test", sub: "emp-1001", use: "login", ...(o.extra ?? {}) })
    .setProtectedHeader({ alg: "RS256", kid: "PRUEBA-1" }).setIssuer(V.iss)
    .setAudience((o.aud ?? V.aud_esperada) as string).setExpirationTime(o.exp ?? iat + 60)
    .setJti(`jti-h-${crypto.randomUUID()}`);
  if (!o.sinIat) j.setIssuedAt(iat);
  return j.sign(clavePriv);
}
const motivo = async (t: string) => {
  const r = await verificarPase(t, opts("login"));
  return r.ok ? "ok" : r.motivo;
};

Deno.test("endurecimiento: firmador propio produce pase valido", async () => {
  assertEquals(await motivo(await firmar()), "ok");
});
Deno.test("endurecimiento: aud como arreglo -> aud", async () => {
  assertEquals(await motivo(await firmar({ aud: [V.aud_esperada] })), "aud");
});
Deno.test("endurecimiento: iat ausente o no numerico -> rechazado", async () => {
  assertEquals(await motivo(await firmar({ sinIat: true, exp: V.ahora + 30 })), "exp");
  assertEquals(await motivo(await firmar({ sinIat: true, exp: V.ahora + 30, extra: { iat: String(V.ahora) } })), "exp");
});
Deno.test("endurecimiento: iat futuro (+61) rechazado; +50 ok", async () => {
  assertEquals(await motivo(await firmar({ iat: V.ahora + 61 })), "exp");
  assertEquals(await motivo(await firmar({ iat: V.ahora + 50 })), "ok");
});
Deno.test("endurecimiento: exp - iat excesivo rechazado; 60 s ok", async () => {
  assertEquals(await motivo(await firmar({ iat: V.ahora - 5, exp: V.ahora + 3595 })), "exp");
  assertEquals(await motivo(await firmar({ iat: V.ahora - 5, exp: V.ahora + 55 })), "ok");
});
Deno.test("endurecimiento: jwksUrl solo https (o localhost / permitirHttp)", () => {
  for (const u of ["http://portal.ejemplo.invalid/j", "ftp://x.invalid/j", "no es url"]) {
    let lanzo = false;
    try { validarJwksUrl(u); } catch { lanzo = true; }
    assertEquals(lanzo, true, u);
  }
  for (const u of ["https://portal.ejemplo.invalid/j", "http://localhost:1/j", "http://127.0.0.1:1/j", "http://[::1]:1/j"]) validarJwksUrl(u);
  validarJwksUrl("http://portal.ejemplo.invalid/j", true);
});

// ---- handler ----
const ana: Usuario = { id: "u-1", rol: "admin", activo: true };
const armar = (usuario: Usuario | null = ana, store = nuevoStore()) => {
  const buscadas: string[] = [];
  const h = crearHandler({
    iss: V.iss, aud: V.aud_esperada, portalUrl: "https://portal.prueba.invalid",
    getKey, ahora, marcarJti: store,
    buscarUsuarioPorCorreo: async (e) => { buscadas.push(e); return usuario; },
    abrirSesion: async () =>
      new Response(null, { status: 302, headers: { Location: "https://app.invalid/#access_token=x" } }),
  });
  return { h, buscadas };
};
const get = (token?: string) =>
  new Request("https://x.invalid/functions/v1/sso/acceso", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
const post = (token: string) =>
  new Request("https://x.invalid/functions/v1/sso/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });

Deno.test("acceso: valido -> 200 acceso true + rol", async () => {
  const r = await armar().h(get(V.casos.valido_acceso.token));
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { acceso: true, rol: "admin" });
  assertEquals(r.headers.get("cache-control")?.includes("no-store"), true);
});

Deno.test("acceso: sin usuario o inactivo -> 200 acceso false", async () => {
  assertEquals(await (await armar(null).h(get(V.casos.valido_acceso.token))).json(), { acceso: false });
  const r = await armar({ id: "1", activo: false }).h(get(V.casos.valido_acceso.token));
  assertEquals(await r.json(), { acceso: false });
});

Deno.test("acceso: sin pase / invalido / use=login / vencido -> 401 sin motivo", async () => {
  for (const t of [undefined, "basura", V.casos.valido_login.token, V.casos.vencido.token, V.casos.alg_none.token]) {
    const { h, buscadas } = armar();
    const r = await h(get(t));
    assertEquals(r.status, 401);
    assertEquals(await r.text(), '{"error":"no autorizado"}');
    assertEquals(buscadas.length, 0);
  }
});

Deno.test("login: valido -> 302; repetido -> 403", async () => {
  const store = nuevoStore();
  const { h } = armar(ana, store);
  const r1 = await h(post(V.casos.valido_login.token));
  assertEquals(r1.status, 302);
  const r2 = await h(post(V.casos.valido_login.token));
  assertEquals(r2.status, 403);
});

Deno.test("login: email en mayusculas se busca en minusculas", async () => {
  const { h, buscadas } = armar();
  assertEquals((await h(post(V.casos.email_mayusculas.token))).status, 302);
  assertEquals(buscadas, ["ana.perez@ecologia.test"]);
});

Deno.test("login: sin usuario -> 403 con enlace al portal, no cacheable", async () => {
  const r = await armar(null).h(post(V.casos.valido_login.token));
  assertEquals(r.status, 403);
  assertEquals((await r.text()).includes("https://portal.prueba.invalid"), true);
  assertEquals(r.headers.get("cache-control")?.includes("no-store"), true);
});

Deno.test("login: pases malos -> 403", async () => {
  for (const n of ["vencido", "iss_ajeno", "aud_ajeno", "firma_ajena", "use_cambiado", "alg_none", "hs256", "basura"]) {
    assertEquals((await armar().h(post(V.casos[n].token))).status, 403, n);
  }
});

Deno.test("login: el pase por query string no sirve; GET no permitido", async () => {
  const { h } = armar();
  const r = await h(new Request(`https://x.invalid/functions/v1/sso/login?token=${V.casos.valido_login.token}`));
  assertEquals(r.status, 405);
});

Deno.test("login: falla abrirSesion -> 403 (falla cerrada)", async () => {
  const h = crearHandler({
    iss: V.iss, aud: V.aud_esperada, portalUrl: "https://p.invalid", getKey, ahora,
    marcarJti: nuevoStore(), buscarUsuarioPorCorreo: async () => ana,
    abrirSesion: () => Promise.reject(new Error("no implementado")),
  });
  assertEquals((await h(post(V.casos.valido_login.token))).status, 403);
});

Deno.test("ruta desconocida -> 404", async () => {
  assertEquals((await armar().h(new Request("https://x.invalid/functions/v1/sso/otra"))).status, 404);
});

// ---- CSRF de login, nosniff, largo del token ----
const postCab = (token: string, cab: Record<string, string>) =>
  new Request("https://x.invalid/functions/v1/sso/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...cab },
    body: new URLSearchParams({ token }),
  });
const PORTAL = "https://portal.prueba.invalid";

Deno.test("CSRF: POST autoenviado del portal (Origin del portal, cross-site) -> 302", async () => {
  const { h } = armar();
  const r = await h(postCab(V.casos.valido_login.token, { Origin: PORTAL, "Sec-Fetch-Site": "cross-site" }));
  assertEquals(r.status, 302);
});

Deno.test("CSRF: Origin ajeno o 'null' -> 403 sin abrir sesion", async () => {
  for (const o of ["https://atacante.invalid", "null", "http://portal.prueba.invalid", PORTAL + ".atacante.invalid"]) {
    const { h, buscadas } = armar();
    const r = await h(postCab(V.casos.valido_login.token, { Origin: o }));
    assertEquals(r.status, 403, o);
    assertEquals(buscadas.length, 0);
  }
});

Deno.test("CSRF: sin Origin: cross-site -> 403; sin cabeceras -> 302", async () => {
  const { h } = armar();
  assertEquals((await h(postCab(V.casos.valido_login.token, { "Sec-Fetch-Site": "cross-site" }))).status, 403);
  assertEquals((await h(post(V.casos.valido_login.token))).status, 302);
});

Deno.test("respuestas con X-Content-Type-Options: nosniff", async () => {
  const { h } = armar();
  assertEquals((await h(get(V.casos.valido_acceso.token))).headers.get("x-content-type-options"), "nosniff");
  assertEquals((await h(post("basura"))).headers.get("x-content-type-options"), "nosniff");
});

Deno.test("verificar: token de mas de 8 KB -> formato", async () => {
  const r = await verificarPase(V.casos.valido_login.token + "A".repeat(9000), { use: "login", iss: V.iss, aud: V.aud_esperada, getKey, ahora, marcarJti: nuevoStore() });
  assertEquals(r, { ok: false, motivo: "formato" });
});

Deno.test("login: falla el RPC de jti -> 403 (no 500)", async () => {
  const h = crearHandler({
    iss: V.iss, aud: V.aud_esperada, portalUrl: "https://p.invalid", getKey, ahora,
    marcarJti: () => Promise.reject(new Error("rpc caido: secreto")), buscarUsuarioPorCorreo: async () => ana,
    abrirSesion: async () => new Response(null, { status: 302 }),
  });
  const r = await h(post(V.casos.valido_login.token));
  assertEquals(r.status, 403);
  assertEquals((await r.text()).includes("secreto"), false);
});

Deno.test("login: falla el RPC de usuario -> 403; acceso -> 401", async () => {
  const h = crearHandler({
    iss: V.iss, aud: V.aud_esperada, portalUrl: "https://p.invalid", getKey, ahora,
    marcarJti: nuevoStore(), buscarUsuarioPorCorreo: () => Promise.reject(new Error("rpc caido")),
    abrirSesion: async () => new Response(null, { status: 302 }),
  });
  const l = await h(post(V.casos.valido_login.token));
  assertEquals(l.status, 403);
  assertEquals(l.headers.get("content-type")?.startsWith("text/html"), true);
  assertEquals((await h(get(V.casos.valido_acceso.token))).status, 401);
});
