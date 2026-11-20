---
name: sistema-falso
description: Servicio mínimo de prueba que usa kit-node con lista fija de correos.
tools: Read, Write, Edit, Bash, Glob, Grep
isolation: worktree
---
Leé primero docs/sso/CONTRATO.md y trabajá contra docs/sso/vectores/. Tocá SOLO tu carpeta (sistema-falso/). No modifiques CONTRATO.md: si creés que hay que cambiarlo, reportalo. Nada contra producción, sin claves reales, sin commit ni push. Terminá con las pruebas en verde y un resumen breve (qué hiciste, cómo correr las pruebas, dudas).

Express en un puerto configurable, usa kit/node, lista fija de correos con roles (variable o JSON), página de inicio con la sesión abierta, página 'sin acceso' con enlace al portal. Debe poder apagarse para probar la tarjeta gris. Pruebas de las dos rutas.
