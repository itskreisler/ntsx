# ntsx

Ejecuta scripts de Node/TypeScript con **dependencias efímeras**, estilo `uv --with`.
Sin tocar la instalación global, sin corromper el `package.json` ni el `node_modules` del
proyecto (el real se restaura al terminar): las deps se bajan a un cache aislado y se
enlazan mediante un symlink temporal de `node_modules`.

## Uso

```bash
# Con un archivo .js/.ts
ntsx run --with axios --with jsdom script.ts

# Con código inline (importa algo que NO tienes instalado)
ntsx run --with jsdom -e "import { JSDOM } from 'jsdom'; console.log(typeof JSDOM)"

# Con versiones
ntsx run --with chalk@^4 script.js arg1

# Pasando argumentos al script
ntsx run --with axios diario.ts hello world
```

## Ejemplos probados

**API Express** (`examples/express-api.ts`):
```ts
import express from 'express'
const app = express()
app.get('/', (_req, res) => res.json({ hello: 'world', via: 'ntsx' }))
app.listen(3000, () => console.log('Express en http://localhost:3000'))
```
```bash
ntsx run --with express express-api.ts
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
ntsx run --with axios --with jsdom scrape.ts
```

**Mismo scraping, inline** (sin archivo):
```bash
ntsx run --with axios --with jsdom -e "(async () => {
  const { default: axios } = await import('axios')
  const { JSDOM } = await import('jsdom')
  const { data } = await axios.get('https://example.com')
  console.log('h1:', new JSDOM(data).window.document.querySelector('h1')?.textContent)
})()"
```

> **Nota inline:** con `tsx` (default del eval) transpila a CJS, así que el **top-level `await`
> falla**. Envuelve el código async en `(async () => { ... })()`, o usa `--eval-runtime node`
> (en Node ≥22.7 el eval plano sí soporta top-level `await`).

## Gestión del cache

```bash
ntsx cache stats            # muestra workspaces + tamaño del cache
ntsx cache clean            # pide confirmación antes de borrar
ntsx cache clean --force    # borra sin confirmar
```

## Dónde **NO** aplica ntsx

`ntsx` resuelve **scripts con deps efímeras**. No aplica a frameworks de **build/proyecto
completo**, que necesitan su propio scaffolding y arbol de dependencias:

- **Astro** — framework de build (`.astro` files, `astro.config`). Se monta con `npm create astro`.
  Aunque `import 'astro'` exponga `build/dev/preview`, necesita estructura de proyecto, no un script suelto.
- **Vite** — bundler con su propio `vite.config` y árbol de deps. Se usa con `npm create vite`.
- **Angular** — CLI con scaffolding (`ng new`) y toolchain propia. No es una dep importable en scripts.
- Otros frameworks/CLI de build (Next, Nuxt, Remix, Vue CLI...).

Para esos usa el toolkit oficial (`npm create <x>`, `npx create-<x>@latest`). `ntsx` brilla para
**utilities à la carte**: un script corto, un scraper, una API de prueba, o replicar un snippet con
deps sin contaminar tu proyecto.

## Instalación

```bash
npm install
npm run build          # tsup → dist/ntsx.js
npm link               # opcional: exponer `ntsx` globalmente (queda en PATH)
```

## Cómo funciona

1. `--with pkg@ver` parsea cada dep y genera un `package.json` en el cache.
2. `npm install` instala las deps en el cache **aislado por workspace**.
3. Se crea un symlink `node_modules` → cache en el directorio del script.
4. Ejecuta con `tsx` (para `.ts`/eval) o `node` (para `.js`), pasando los args restantes.

> **Integridad del proyecto:** si en el directorio del script ya existe un `node_modules`
> real, se aparta temporalmente (`.ntsx-<ts>.bak`), se crea el symlink a las deps efímeras
> y al terminar el script se restaura el original. Nunca se destruye tu `node_modules`.

Los caches de la **segunda ejecución** en adelante son instantáneos (npm ya las tiene).

## Cache y aislamiento

Estructura del cache:

```
~/.cache/ntsx/                 # en Windows: C:\Users\usuario\.cache\ntsx
  <workspaceHash>/            # aísla por proyecto (hash del dir del script)
    <depsHash>/               # aísla por conjunto de deps
      node_modules/
```

La ruta del home se obtiene de `%USERPROFILE%` (Windows) o `$HOME` (Linux/macOS),
por lo que siempre acaba en `~/.cache/ntsx` independientemente del SO.

Cada proyecto (workspace) tiene sus propias deps. Dos proyectos que usen deps distintas
**no se mezclan**. El mismo proyecto con los mismos `--with` reutiliza el cache.

Para limpiar: `rm -rf ~/.cache/ntsx`.

## Opciones

| Flag | Descripción |
|------|-------------|
| `-w, --with <pkg>` | Dep efímera (`pkg`, `pkg@version`, `@scope/pkg`, `@scope/pkg@version`). Repetible |
| `-e, --eval <code>` | Ejecuta código inline (igual que `node -e`/`tsx -e`) |
| `--eval-runtime <tsx\|node>` | Runner del eval (default: `tsx`) |
| `--tsx-args <flags>` | Flags que van a `tsx` antes del script (`.ts`/`.tsx` y eval). Repetible |
| `--node-args <flags>` | Flags que van a `node` antes del script (`.js`/`.mjs`). Repetible |
| `--npm-args <flags>` | Flags que van al `npm install` del caché. Repetible |
| `-q, --quiet` | Silencia la salida de `npm install` |
| `-d, --debug` | Muestra el flujo interno: rutas del caché, comando `npm install`, symlink, comando del runner y restore |
| `--node <version>` | Pin de versión de Node (**reservado**, para una versión futura) |
| `-h, --help` | Ayuda |

## Orden de los flags (igual que tsx)

```
ntsx run [flags del runtime] ./file.ts [flags y args del script]
```

- Los flags del **runner** (`--tsx-args`, `--node-args`, `--npm-args`) van **antes del script** y se reenvían a su CLI interno correspondiente.
- Todo lo que vaya **después del script** se pasa **tal cual al script** (gracias a `passThroughOptions`), aunque parezca un flag de ntsx. Ejemplo:

```bash
ntsx run --tsx-args "--tsconfig=tsconfig.custom.json" src/main.ts
ntsx run ./app.ts --verbose --with foo    # --verbose --with foo → del script, no de ntsx
ntsx run --npm-args "--registry=https://registry.npmjs.org" -e "console.log('ok')"
ntsx run --eval-runtime node -e "await Promise.resolve()"   # eval plano con node nativo
```

## Requsitos

- Node.js ≥ 18
- `tsx` disponible (se usa para `.ts`/eval); si no está, ntsx hace fallback a `npx -y tsx`

## Proyecto

- TypeScript (última estable) + Commander (parseo de CLI) + zod (validación de args)
- Build con `tsup` → `dist/ntsx.js` (single file, shebang incluido)