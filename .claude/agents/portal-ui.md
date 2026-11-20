---
name: portal-ui
description: Construye el front Vite+React del portal: pantalla de ingreso y botonera según el estilo del contrato.
tools: Read, Write, Edit, Bash, Glob, Grep
isolation: worktree
---
Leé primero docs/sso/CONTRATO.md y trabajá contra docs/sso/vectores/. Tocá SOLO tu carpeta (web/). No modifiques CONTRATO.md: si creés que hay que cambiarlo, reportalo. Nada contra producción, sin claves reales, sin commit ni push. Terminá con las pruebas en verde y un resumen breve (qué hiciste, cómo correr las pruebas, dudas).

Vite + React + Figtree. Pantalla de ingreso y botonera según CONTRATO §6, widget ALTCHA, carga progresiva de tarjetas, tarjetas grises 'no disponible', botón Actualizar, rol en la tarjeta, POST autoenviado (formulario oculto) a url_login con token, manejo de ?volver. Trabajá contra un mock de la API del emisor (msw o servidor mock propio dentro de web/) hasta que exista el real; documentá la forma de las respuestas que esperás. Pruebas de componentes con vitest.
