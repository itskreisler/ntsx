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

## Ejemplos probados

**API Express** (`examples/express-api.ts`):
```ts
import express from 'express'
const app = express()
app.get('/', (_req, res) => res.json({ hello: 'world', via: 'ntx' }))
app.listen(3000, () => console.log('Express en http://localhost:3000'))
```
```bash
ntx run --with express express-api.ts
```

**Scrape web con axios + jsdom contra example.com**:
```ts
import { JSDOM } from 'jsdom'
;(async () => {
  const { default: axios } = await import('axios')
  const { data } = await axios.get('https://example.com')
  console.log('h1:', new JSDOM(data).window.document.querySelector('h1')?.textContent)
})()
```
```bash
ntx run --with axios --with jsdom scrape.ts
```

**Mismo scraping, inline** (sin archivo):
```bash
ntx run --with axios --with jsdom -c "(async () => {
  const { default: axios } = await import('axios')
  const { JSDOM } = await import('jsdom')
  const { data } = await axios.get('https://example.com')
  console.log('h1:', new JSDOM(data).window.document.querySelector('h1')?.textContent)
})()"
```

> **Nota inline:** `tsx -e` transpila a CJS, así que el **top-level `await` falla**. Envuelve el
> código async en `(async () => { ... })()`.

## Gestión del cache

```bash
ntx cache stats            # muestra workspaces + tamaño del cache
ntx cache clean            # pide confirmación antes de borrar
ntx cache clean --force    # borra sin confirmar
```

## Dónde **NO** aplica ntx

`ntx` resuelve **scripts con deps efímeras**. No aplica a frameworks de **build/proyecto
completo**, que necesitan su propio scaffolding y arbol de dependencias:

- **Astro** — framework de build (`.astro` files, `astro.config`). Se monta con `npm create astro`.
  Aunque `import 'astro'` exponga `build/dev/preview`, necesita estructura de proyecto, no un script suelto.
- **Vite** — bundler con su propio `vite.config` y árbol de deps. Se usa con `npm create vite`.
- **Angular** — CLI con scaffolding (`ng new`) y toolchain propia. No es una dep importable en scripts.
- Otros frameworks/CLI de build (Next, Nuxt, Remix, Vue CLI...).

Para esos usa el toolkit oficial (`npm create <x>`, `npx create-<x>@latest`). `ntx` brilla para
**utilities à la carte**: un script corto, un scraper, una API de prueba, o replicar un snippet con
deps sin contaminar tu proyecto.

## Instalación

```bash
npm install
npm run build          # tsup → dist/ntx.js
npm link               # opcional: exponer `ntx` globalmente (queda en PATH)
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