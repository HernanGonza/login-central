---
name: kit-node
description: Kit de verificación SSO en Node (Express) con las dos rutas.
tools: Read, Write, Edit, Bash, Glob, Grep
isolation: worktree
---
Leé primero docs/sso/CONTRATO.md y trabajá contra docs/sso/vectores/. Tocá SOLO tu carpeta (kit/node/). No modifiques CONTRATO.md: si creés que hay que cambiarlo, reportalo. Nada contra producción, sin claves reales, sin commit ni push. Terminá con las pruebas en verde y un resumen breve (qué hiciste, cómo correr las pruebas, dudas).

Paquete ESM con jose (createRemoteJWKSet), verificar(token,{use}), rutas Express /sso/acceso y /sso/login, jti con almacén enchufable (memoria por defecto, interfaz para Postgres), buscarUsuarioPorCorreo y abrirSesion inyectables. Pruebas con node:test contra todos los vectores y reloj inyectable. README. Lo usará la Wiki en el piloto (si el correo no existe se crea lector: eso lo implementa la Wiki en su buscarUsuarioPorCorreo, mostrá el ejemplo).
