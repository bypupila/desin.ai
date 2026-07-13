# PRD: Paquete npm unificado

## Objetivo
Permitir que una aplicación Vite + React instale el inspector con un solo paquete: `@design-bypupila/inspector`.

## Criterios de aceptación

- El paquete raíz exporta el runtime existente.
- `@design-bypupila/inspector/vite` exporta `desinInspectorVite`.
- `@design-bypupila/inspector/vite/client` exporta `createProjectStorage`.
- `@design-bypupila/inspector/react` exporta `getReactSourceInfo` y `getReactStackContext`.
- El ejemplo Vite + React utiliza únicamente imports desde `@design-bypupila/inspector`.
- El release dry-run valida y empaqueta únicamente el paquete público unificado.
- README y comandos de instalación no requieren los tres paquetes anteriores.
- `npm run build` y `npm run check` terminan correctamente.

## Fuera de alcance

- Cambiar el comportamiento visual o funcional del inspector.
- Publicar el paquete en npm desde esta tarea.
- Eliminar inmediatamente los directorios históricos de los paquetes internos.
