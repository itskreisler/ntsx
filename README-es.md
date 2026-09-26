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
  <b>Node ≥ 22</b>
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
ntsx run --with qrcode -e "import QR from 'qrcode'; QR.toString('https://npmjs.com/package/@kreisler/ntsx', {type:'terminal', small:true}).then(console.log)"

# con versiones
ntsx run --with chalk@^4 script.js arg1

# fijando versión de Node
ntsx run --node 24 script.ts

# generar lockfile
ntsx lock script.ts

# ejecutar tool efímera
ntsx tool prettier --write script.ts

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

**Args del eval con `-e`**: el código inline sigue la convención clásica de `node -e` / `tsx -e` —
los argumentos del script van **después** de un separador `--` (si no, flags como `-h` o `--name=x`
los captura el propio CLI o node):

```bash
ntsx run --with argv2object -e "import a from 'argv2object'; console.log(a())" -- -h --name=Kreisler --is-admin
#                                                                          ↑ args del script
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

# 🛠️ Stacks complejos (Express + Axios + CORS + Multer + Zod)
ntsx run --with express --with axios --with cors --with multer --with zod examples/21-express-stack.ts

# 🔐 Autenticación JWT con Hono + JOSE
ntsx run --with hono --with @hono/node-server --with jose examples/22-hono-jwt.ts

# 🔑 Generador TOTP + Código QR (Axios + OTPAuth + QRCode)
ntsx run --with axios --with otpauth --with qrcode examples/23-otpauth-qr.ts

# 🎯 Argumentos pasados al script
ntsx run --with argv2object examples/24-argv.ts --name=Kreisler archivo.txt --debug

# 🎯 Eval inline + args del script (usar -- como separador)
ntsx run --with argv2object -e "import a from 'argv2object'; console.log(a(true))" -- -h --help --name=Kreisler --is-admin
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
ntsx cache dir              # imprime la ruta absoluta del caché
ntsx cache clean            # pide confirmación
ntsx cache clean --force    # borra sin piedad
ntsx cache prune            # limpia elementos huérfanos del caché
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
| `--node <version>` | Pin de Node (descarga la versión en `~/.cache/ntsx/node/`) |

## Script Metadata

Los scripts pueden declarar sus dependencias y versión de Node directamente en un encabezado:

```typescript
// /// ntsx
// dependencies = [
//   "axios",
//   "chalk"
// ]
// node = "24"
// ///

import chalk from 'chalk'
import axios from 'axios'
```

Y ejecutarse simplemente con: `ntsx run script.ts`

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

**Requisitos:** Node ≥ 22 · `tsx` (si no está, `npx -y tsx` de fallback).

## Stack

- TypeScript + Commander (CLI) + zod (validación)
- `tsup` → bundle autosuficiente (`commander`, `zod` incluidos en `dist`)
- Tests con `node:test` (63/63 ✅)

---

## 25/25 tests pasan ✅

Sí, todos los flags funcionan correctamente. La descripción del comando es correcta:

```cmd
:: Windows CMD
(set "USER_ID=67") && ntsx run [run flags] ./file.ts -- [flags & arguments for file.ts]
```

```powershell
# Windows PowerShell
$env:USER_ID="67"; ntsx run [run flags] ./file.ts -- [flags & arguments for file.ts]
```

### Flags disponibles para `ntsx run`:

| Flag | Descripción | Estado | Dependencias |
|------|-------------|--------|--------------|
| `-w, --with <pkg>` | Dependencia efímera (repetible) | ✅ | Necesita `-e` o `<script>` |
| `-e, --eval <code>` | Evaluar código inline | ✅ | Independiente |
| `--eval-runtime <tsx\|node>` | Runtime para eval (default: tsx) | ✅ | Requiere `-e` |
| `--tsx-args <args>` | Flags para tsx (repetible) | ✅ | Requiere `-e` o script `.ts` |
| `--node-args <args>` | Flags para node (repetible) | ✅ | Requiere script `.js`/`.mjs` |
| `--npm-args <args>` | Flags para npm (repetible) | ✅ | Requiere `--with` |
| `-q, --quiet` | Suprimir output de npm install | ✅ | Requiere `--with` |
| `-d, --debug` | Mostrar pasos internos | ✅ | Independiente |
| `--node <version>` | Fijar versión de Node.js | ✅ | Independiente |
| `<script>` | Ruta al script | ✅ | Independiente |
| `-- <args>` | Argumentos para el script | ✅ | Requiere `-e` o `<script>` |

### Pruebas de independencia:

**Flags independientes** (funcionan sin otros flags):
- `-e, --eval <code>` → `ntsx run -e "console.log('hola')"` ✅
- `-d, --debug` → `ntsx run -d -e "console.log('hola')"` ✅
- `--node <version>` → `ntsx run --node 24.1.0 -e "console.log(process.version)"` ✅
- `<script>` → `ntsx run script.ts` ✅

**Flags que requieren otros flags:**
- `--eval-runtime` → Solo tiene sentido con `-e`
- `--tsx-args` → Solo aplica a scripts `.ts` o `-e` (tsx)
- `--node-args` → Solo aplica a scripts `.js`/`.mjs` (node)
- `--npm-args` → Solo aplica cuando hay `--with` (npm install)
- `-q, --quiet` → Solo afecta output de `--with` (npm install)
- `-- <args>` → Solo pasa argumentos si hay script o eval

### Ejemplos de uso combinado:

```bash
# --with + -e
ntsx run --with chalk -e "import c from 'chalk'; console.log(c.green('hola'))"

# --with + <script>
ntsx run --with chalk script.ts

# --eval-runtime + -e
ntsx run --eval-runtime node -e "console.log('hola')"

# --tsx-args + -e
ntsx run --tsx-args --version -e "console.log('hola')"

# --node-args + script.js
ntsx run --node-args --version script.js

# --npm-args + --with
ntsx run --npm-args --loglevel=error --with chalk -e "..."

# --quiet + --with
ntsx run -q --with chalk -e "..."

# --node + -e
ntsx run --node 24.1.0 -e "console.log(process.version)"

# -- + script
ntsx run script.ts -- --name test --value 123
```

### Tests verificados (25/25):

- ✅ Ejecución de código JS/TS con `-e`
- ✅ Ejecución de archivos `.mjs` y `.ts`
- ✅ Instalación de paquetes con `--with`
- ✅ Múltiples paquetes con `--with`
- ✅ Paquetes scoped con versión
- ✅ Pasar argumentos después de `--`
- ✅ `--tsx-args` (versión, múltiples, env-file, tsconfig)
- ✅ `--node-args` (versión, env-file)
- ✅ Carga de `.env` con `--env-file`
- ✅ Ejemplos del `--help` (5/5)
- ✅ Detección de UTF-16
- ✅ `--debug`
- ✅ `cache dir` y `cache stats`

---

<div align="center">

MIT · hecho con ❤️ para los que tienen prisa

</div>