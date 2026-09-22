<div align="center">

# ⚡ ntsx

**Corre cualquier script de Node/TS con dependencias efímeras — sin `npm install`, sin contaminar tu proyecto.**

```bash
ntsx run --with chalk -e "import c from 'chalk'; console.log(c.green('hola mundo'))"
```

**Siembra, corre, restaura. Tu `node_modules` queda tal cual.**
*Estilo `uv --with` para Node.js.*

> 🌐 [English](/README.md)

---

<p>
  <b>npm run</b> ·
  <b>tsx</b> ·
  <b>npx</b> ·
  <b>uv --with</b> ·
  <b>Node ≥ 18</b>
</p>

</div>

---

## ¿Qué es esto?

`ntsx` ejecuta un script (`.js`, `.ts`, `.tsx`, o código inline con `-e`) y le da **dependencias
efímeras**: las instala sobre la marcha en un caché aislado `~/.cache/ntsx`, las enlaza con un
`node_modules` temporal, y **restaura tu `node_modules` real al terminar**.

Un snippet, un scraper, una API de prueba, un QR en el terminal... **sin tocar el `package.json`**
de tu proyecto. Como `uv --with`, pero para Node.

```bash
# script con deps que NO tienes instaladas
ntsx run --with axios --with jsdom examples/scrape.ts

# código inline, sin crear ni un archivo
ntsx run --with qrcode -e "import QR from 'qrcode'; QR.toString('https://ntsx.dev', {type:'terminal', small:true}).then(console.log)"

# con versiones
ntsx run --with chalk@^4 script.js arg1

# pasando argumentos al script
ntsx run --with axios diario.ts --fecha hoy
```

## ¿Por qué ntsx y no <del>npx/tsx/npm</del>?

| Lo que quieres hacer | npx | tsx | ntsx |
|---|---|---|---|
| Correr TS sin instalar nada | ❌ no transpila | ✅ | ✅ |
| Usar una dep que no tienes instalada | ⚠️ `npx -p chalk` (feo) | ❌ hay que `npm i` | ✅ `--with chalk` |
| Repetibles, con versiones | ⚠️ | ❌ | ✅ `--with @scope/pkg@^2` |
| Sin tocar tu `package.json` | ✅ | ❌ | ✅ |
| Sin romper tu `node_modules` | ❌ suele ensuciar | ⚠️ | ✅ (se restaura) |
| Caché reutilizable entre corridas | ⚠️ | ❌ | ✅ `~/.cache/ntsx` |

**Orden de los flags**: lo de **antes** del script es del runner, lo de **después** es del script
(igual que tsx):

```bash
ntsx run --tsx-args "--tsconfig=tsconfig.custom.json" src/main.ts --verbose
#                       ↑ flags del runner                    ↑ flags del script
```

## Ejemplos reales (probados ✅)

```bash
# 🕷️ Scraper con axios + jsdom
ntsx run --with axios --with jsdom examples/scrape.ts https://example.com
# title:  Example Domain
# h1:     Example Domain
# links:  1

# 📟 QR escaneable directo en tu terminal
ntsx run --with qrcode examples/qr.ts "https://npmjs.com/package/@kreisler/ntsx"

# 🚀 API con Express
ntsx run --with express examples/express-api.ts

# ⚡️ API con Hono (+ servidor nativo de node)
ntsx run --with @hono/node-server --with hono examples/hono-api.ts
```

### Servidores de verdad: `ntsx` + pm2

`ntsx` se reenvía a un `spawn` asíncrono y **restaura el `node_modules` incluso si lo matan** con
`SIGINT`/`SIGTERM` (Ctrl+C o `pm2 stop`). Así un server aguanta las 24/7 y tu proyecto queda limpio:

```bash
pm2 start node --name api -- dist/ntsx.js run --with express examples/express-api.ts
pm2 list
curl http://localhost:3000/
pm2 stop api       # → el node_modules original vuelve a su sitio
```

## ¿Cómo funciona?

```
ntsx run --with chalk -e "..."
        │
        ▼
┌─ 1. hash del workspace + deps ───────────────┐
│   ~/.cache/ntsx/<workspaceHash>/<depsHash>/  │
├─ 2. ¿ya instalado? ──► sí → skip npm install ┤
│   no → package.json + npm install (aislado)   │
├─ 3. aparta TU node_modules (`.bak` temporal) ─┤
│   y crea el symlink a las deps efímeras       │
├─ 4. ejecuta: .ts→tsx · .js→node · eval→tsx ──┤
│   (o `--eval-runtime node` para node nativo)  │
└─ 5. ¡SIEMPRE restaura TU node_modules! ───────┘
```

**Integridad garantizada**: tu `node_modules` real se aparta (`.ntsx-<ts>.bak`), se enlaza el caché
y al terminar (incluso ante señal) se restaura. Nunca se destruye. **Los symlink huérfanos de un
crash se auto-curan** en la siguiente corrida.

> Segunda corrida en adelante: **instantánea** (el caché ya las tiene).

## Gestión del caché

```bash
ntsx cache stats            # workspaces + tamaño
ntsx cache clean            # pide confirmación
ntsx cache clean --force    # borra sin piedad
```

```
~/.cache/ntsx/                # en Windows: %USERPROFILE%\.cache\ntsx
  <workspaceHash>/            # aísla por proyecto (nunca mezcla proyectos)
    <depsHash>/               # aísla por conjunto de deps
      node_modules/
```

## Opciones

| Flag | Descripción |
|------|-------------|
| `-w, --with <pkg>` | Dep efímera (`pkg`, `pkg@version`, `@scope/pkg@version`). Repetible |
| `-e, --eval <code>` | Código inline (como `node -e` / `tsx -e`) |
| `--eval-runtime <tsx\|node>` | Runner del eval (default: `tsx`) |
| `--tsx-args <flags>` | Flags para `tsx` antes del script (`.ts`/eval). Repetible |
| `--node-args <flags>` | Flags para `node` antes del script (`.js`/`.mjs`). Repetible |
| `--npm-args <flags>` | Flags para el `npm install` del caché. Repetible |
| `-q, --quiet` | Silencia la salida de `npm install` |
| `-d, --debug` | Traza el flujo: rutas del caché, comandos, symlink, restore |
| `--node <version>` | Pin de Node (**reservado** para una próxima versión) |

## ¿Cuándo NO usar ntsx?

`ntsx` brilla para **utilities à la carte**, no para frameworks de build con su propio scaffolding
(Astro, Vite, Angular, Next, Nuxt...). Para esos usa el toolkit oficial (`npm create <x>`).

> ✨ ntsx = 0 fricción en el **99% de los scripts**: cópialo en los snippets, sácalo en producción.

## Instalación

```bash
npm install -g @kreisler/ntsx   # 🚀 uso directo: `ntsx` queda en tu PATH
```

O, desde este repo:

```bash
npm install                 # deps del desarrollo
npm run build               # tsup → dist/ntsx.js (single-file, shebang)
npm link                    # opcional: `ntsx` en tu PATH
```

**Requisitos:** Node ≥ 18 · `tsx` (si no está, `npx -y tsx` de fallback).

## Stack

- TypeScript + Commander (CLI) + zod (validación)
- `tsup` → bundle autosuficiente (`commander`, `zod` incluidos en `dist`)
- Tests con `node:test` (20/20 ✅)

---

<div align="center">

MIT · hecho con ❤️ para los que tienen prisa

</div>