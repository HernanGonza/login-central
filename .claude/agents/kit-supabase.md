---
name: kit-supabase
description: Edge Function sso para Supabase autoalojado (Ecodatos y Alerta Temprana) con SQL y migraciones.
tools: Read, Write, Edit, Bash, Glob, Grep
isolation: worktree
---
Leé primero docs/sso/CONTRATO.md y trabajá contra docs/sso/vectores/. Tocá SOLO tu carpeta (kit/supabase/). No modifiques CONTRATO.md: si creés que hay que cambiarlo, reportalo. Nada contra producción, sin claves reales, sin commit ni push. Terminá con las pruebas en verde y un resumen breve (qué hiciste, cómo correr las pruebas, dudas).

Deno + jose createRemoteJWKSet. Rutas /functions/v1/sso/acceso y /login. Funciones SQL security definer ejecutables solo por service_role (auth.users para Ecodatos; tabla de usuarios del schema de Alerta, por correo en minúsculas; el nombre de tabla/columna de Alerta va parametrizado porque falta confirmarlo). Tabla sso.jti_usados. Sesión Ecodatos: auth.admin.generateLink + verifyOtp en servidor, entrega en fragmento de URL para setSession, sin enviar correo. Alerta: dejá un punto de extensión claro (pendiente cómo abre su sesión hoy). Variables SSO_JWKS_URL, SSO_ISSUER, SSO_AUD. Documentá cómo exceptuar solo la función sso del VERIFY_JWT en volumes/functions/main/index.ts, sin tocar JWT_SECRET. Pruebas con deno test contra vectores si hay Deno (o vía docker denoland/deno).
