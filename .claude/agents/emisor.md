---
name: emisor
description: Construye el emisor del portal: adaptador de Personal, claves/JWKS, emisión de pases, ingreso con límite de intentos y ALTCHA, sesión, sso_sistemas y endpoint de tarjetas.
tools: Read, Write, Edit, Bash, Glob, Grep
isolation: worktree
---
Leé primero docs/sso/CONTRATO.md y trabajá contra docs/sso/vectores/. Tocá SOLO tu carpeta (server/). No modifiques CONTRATO.md: si creés que hay que cambiarlo, reportalo. Nada contra producción, sin claves reales, sin commit ni push. Terminá con las pruebas en verde y un resumen breve (qué hiciste, cómo correr las pruebas, dudas).

Express + pg + jose. Implementá: adaptador PersonalAdapter con implementación PRUEBA (Postgres local, argon2id) y migración/seed de prueba; manejo de correo no encontrado/vacío/duplicado (con pruebas); par de claves y /.well-known/jwks.json con kid; emisión de pases acceso/login (aud, exp=iat+60, jti); POST /api/ingreso con límite por correo e IP y verificación ALTCHA auto-alojada; sesión por cookie HttpOnly/Secure/SameSite=Lax 8 h; migración y semillas de sso_sistemas (personal, wiki, pesca); GET /api/tarjetas (siempre_visible inmediato) y consulta en paralelo con timeout 3 s y caché 10 min en sesión + forzar actualización; POST /api/entrar/:id que devuelve el pase login; validación de volver contra sso_sistemas. Prueba: un pase emitido se verifica con jose usando solo el JWKS. Logs sin secretos ni pases.
