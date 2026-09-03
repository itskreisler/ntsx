# ntx

Ejecuta scripts de Node/TypeScript con **dependencias efímeras**, estilo `uv --with`.
Sin tocar la instalación global, sin corromper el `package.json` del proyecto: las deps
se bajan a un cache aislado y se enlazan mediante un symlink de `node_modules`.

## Uso

```bash
# Con un archivo .js/.ts
ntx run --with axios --with jsdom script.ts

# Con código inline (importa algo que NO tienes instalado)
ntx run --with jsdom -c "import { JSDOM } from 'jsdom'; console.log(typeof JSDOM)"

# Con versiones
ntx run --with chalk@^4 script.js arg1

# Pasando argumentos al script
ntx run --with axios diario.ts hello world
```

## Instalación

```bash
npm install
npm run build          # tsup → dist/ntx.js
npm link               # opcional: exponer `ntx` globalmente
```

Con `npm link`, `ntx` queda en el PATH:

```bash
ntx run --with jsdom -c "import { JSDOM } from 'jsdom'; console.log(typeof JSDOM)"
```

## Cómo funciona

1. `--with pkg@ver` parsea cada dep y genera un `package.json` en el cache.
2. `npm install` instala las deps en el cache **aislado por workspace**.
3. Se crea un symlink `node_modules` → cache en el directorio del script.
4. Ejecuta con `tsx` (para `.ts`/eval) o `node` (para `.js`), pasando los args restantes.

Los caches de la **segunda ejecución** en adelante son instantáneos (npm ya las tiene).

## Cache y aislamiento

Estructura del cache:

```
~/.cache/ntx/                 # en Windows: C:\Users\usuario\.cache\ntx
  <workspaceHash>/            # aísla por proyecto (hash del dir del script)
    <depsHash>/               # aísla por conjunto de deps
      node_modules/
```

La ruta del home se obtiene de `%USERPROFILE%` (Windows) o `$HOME` (Linux/macOS),
por lo que siempre acaba en `~/.cache/ntx` independientemente del SO.

Cada proyecto (workspace) tiene sus propias deps. Dos proyectos que usen deps distintas
**no se mezclan**. El mismo proyecto con los mismos `--with` reutiliza el cache.

Para limpiar: `rm -rf ~/.cache/ntx`.

## Opciones

| Flag | Descripción |
|------|-------------|
| `-w, --with <pkg>` | Dep efímera (`pkg`, `pkg@version`, `@scope/pkg`, `@scope/pkg@version`). Repetible |
| `-c, --eval <code>` | Ejecuta código inline (tipo `node -e`) |
| `-q, --quiet` | Silencia salida extra de ntx |
| `--node <version>` | Pin de versión de Node (**reservado**, para una versión futura) |
| `-h, --help` | Ayuda |

## Requsitos

- Node.js ≥ 18
- `tsx` disponible (se usa para `.ts`/eval); si no está, ntx hace fallback a `npx -y tsx`

## Proyecto

- TypeScript (última estable) + Commander (parseo de CLI) + zod (validación de args)
- Build con `tsup` → `dist/ntx.js` (single file, shebang incluido)