# Paquete npm unificado

## Status
Done

## Problem
La integración actual exige instalar tres paquetes npm separados para un proyecto Vite + React, aunque el usuario percibe el inspector como una única herramienta.

## Desired Behavior
Un proyecto consumidor debe instalar únicamente `@design-bypupila/inspector` y poder importar desde el mismo paquete el runtime, la integración Vite, el almacenamiento del proyecto y el adaptador React.

## Resolved Language
- `@design-bypupila/inspector` es el paquete público único.
- Vite y React son integraciones internas expuestas mediante subrutas del paquete.

## Decisions
- Se mantiene la separación de responsabilidades en el código fuente para preservar mantenibilidad.
- Se publica únicamente el paquete raíz consolidado.
- Se conservan subrutas explícitas (`/vite`, `/vite/client`, `/react`) para evitar mezclar runtime de navegador y plugin de servidor.

## Constraints
- La instalación debe funcionar con npm en proyectos Vite + React.
- El paquete debe poder compilarse, tiparse y probarse desde el monorepo.
- La documentación debe mostrar únicamente el flujo de instalación unificado.

## Open Questions
- El scope `design-bypupila` debe existir en npm y pertenecer al usuario u organización que publique.

## PRD
`docs/prd/unified-npm-package.md`
