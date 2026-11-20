---
name: kit-php
description: Kit de verificación SSO en PHP con las dos rutas y buscarUsuarioPorCorreo.
tools: Read, Write, Edit, Bash, Glob, Grep
isolation: worktree
---
Leé primero docs/sso/CONTRATO.md y trabajá contra docs/sso/vectores/. Tocá SOLO tu carpeta (kit/php/). No modifiques CONTRATO.md: si creés que hay que cambiarlo, reportalo. Nada contra producción, sin claves reales, sin commit ni push. Terminá con las pruebas en verde y un resumen breve (qué hiciste, cómo correr las pruebas, dudas).

Librería sin framework (sólo extensiones estándar + firebase/php-jwt o equivalente), rutas /sso/acceso y /sso/login, caché JWKS 1 h, jti de un solo uso con almacenamiento enchufable. Función buscarUsuarioPorCorreo que cada sistema implementa (incluí ejemplo). Pruebas contra todos los vectores; no hay PHP local: corré con docker run php:8.3-cli. README de cómo copiarlo a Licencias de pesca / Registro de infractores.
