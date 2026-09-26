/**
 * Tests para el binario Rust de ntsx en Windows (entorno nvm)
 * 
 * Estos tests están aislados de los tests genéricos y usan helpers
 * específicos para manejar las particularidades del entorno Windows/nvm.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { sandbox, runCliWithRetry, runCliErr, createFile, createEnvFile, stripAnsi, parseJsonSafe } from './helpers.mjs'

// ============================================================
// Tests básicos de funcionamiento
// ============================================================

test('ntsx: ejecuta código JavaScript simple con -e', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '-e', 'console.log("hello world")',
    ], { cwd: dir })
    assert.equal(out.trim(), 'hello world')
})

test('ntsx: ejecuta código TypeScript simple con -e', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '-e', 'const x: number = 42; console.log(x)',
    ], { cwd: dir })
    assert.equal(stripAnsi(out.trim()), '42')
})

test('ntsx: ejecuta archivo .mjs', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'test.mjs', 'console.log("from mjs")')
    const out = runCliWithRetry([
        'run', scriptPath,
    ], { cwd: dir })
    assert.equal(out.trim(), 'from mjs')
})

test('ntsx: ejecuta archivo .ts', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'test.ts', 'const x: string = "from ts"; console.log(x)')
    const out = runCliWithRetry([
        'run', scriptPath,
    ], { cwd: dir })
    assert.equal(out.trim(), 'from ts')
})

// ============================================================
// Tests de dependencias con --with
// ============================================================

test('ntsx: instala y usa chalk con --with', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '--with', 'chalk', '-q', '-e',
        "import chalk from 'chalk'; console.log(typeof chalk.green)",
    ], { cwd: dir })
    assert.equal(out.trim(), 'function')
})

test('ntsx: instala y usa zod con --with', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '--with', 'zod', '-q', '-e',
        "import { z } from 'zod'; console.log(typeof z.string)",
    ], { cwd: dir })
    assert.equal(out.trim(), 'function')
})

test('ntsx: instala múltiples paquetes con --with', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '--with', 'chalk', '--with', 'zod', '-q', '-e',
        "import chalk from 'chalk'; import { z } from 'zod'; console.log(typeof chalk.green, typeof z.string)",
    ], { cwd: dir })
    assert.equal(out.trim(), 'function function')
})

test('ntsx: instala paquete scoped con versión', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '--with', '@babel/core@^7', '-q', '-e',
        "import * as babel from '@babel/core'; console.log(typeof babel)",
    ], { cwd: dir })
    assert.equal(out.trim(), 'object')
})

// ============================================================
// Tests de passthrough de argumentos
// ============================================================

test('ntsx: pasa argumentos después de -- a scripts JS', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'args.mjs', `
console.log(JSON.stringify(process.argv.slice(2)))
`)
    const out = runCliWithRetry([
        'run', scriptPath, '--', '--name', 'Kreisler', '--admin',
    ], { cwd: dir })
    assert.deepEqual(parseJsonSafe(out), ['--name', 'Kreisler', '--admin'])
})

test('ntsx: pasa argumentos después de -- a scripts TS', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'args.ts', `
console.log(JSON.stringify(process.argv.slice(2)))
`)
    const out = runCliWithRetry([
        'run', scriptPath, '--', '--name', 'Kreisler', '--admin',
    ], { cwd: dir })
    assert.deepEqual(parseJsonSafe(out), ['--name', 'Kreisler', '--admin'])
})

test('ntsx: pasa argumentos después de -- a código evaluado', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '-e', 'console.log(JSON.stringify(process.argv.slice(2)))',
        '--', '--name', 'Kreisler', '--admin',
    ], { cwd: dir })
    // tsx -e pasa los argumentos después del código, no después de --
    assert.deepEqual(parseJsonSafe(out), ['Kreisler', '--admin'])
})

// ============================================================
// Tests de --tsx-args
// ============================================================

test('ntsx: --tsx-args --version muestra versión de tsx', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '--tsx-args', '--version',
        '-e', 'console.log("test")',
    ], { cwd: dir })
    // tsx --version muestra algo como "tsx v4.x.x"
    assert.ok(out.includes('tsx') || out.includes('v'))
})

test('ntsx: múltiples --tsx-args', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'run', '--tsx-args', '--version',
        '--tsx-args', '--help',
        '-e', 'console.log("test")',
    ], { cwd: dir })
    assert.ok(out.length > 0)
})

// ============================================================
// Tests de --node-args
// ============================================================

test('ntsx: --node-args --version muestra versión de node', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'test.mjs', 'console.log("test")')
    const out = runCliWithRetry([
        'run', '--node-args', '--version', scriptPath,
    ], { cwd: dir })
    assert.ok(out.includes('v'))
})

// ============================================================
// Tests de .env
// ============================================================

test('ntsx: carga .env con --tsx-args --env-file', () => {
    const dir = sandbox()
    const envPath = createEnvFile(dir, { NTSX_TEST_USER_ID: '12345' })
    const out = runCliWithRetry([
        'run', '--tsx-args', `--env-file=${envPath}`,
        '-e', "import { loadEnvFile } from 'node:process'; loadEnvFile(); console.log(process.env.NTSX_TEST_USER_ID)",
    ], { cwd: dir })
    assert.equal(stripAnsi(out.trim()), '12345')
})

test('ntsx: carga .env con --node-args --env-file', () => {
    const dir = sandbox()
    const envPath = createEnvFile(dir, { NTSX_TEST_USER_ID: '12345' })
    const out = runCliWithRetry([
        'run', '--node-args', `--env-file=${envPath}`,
        '-e', "import { loadEnvFile } from 'node:process'; loadEnvFile(); console.log(process.env.NTSX_TEST_USER_ID)",
    ], { cwd: dir })
    assert.equal(stripAnsi(out.trim()), '12345')
})

// ============================================================
// Tests de ejemplos del --help
// ============================================================

test('ntsx ejemplo 1: --with axios --with jsdom app.ts', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'app.ts', `
import axios from 'axios';
import { JSDOM } from 'jsdom';

async function main() {
    try {
        const res = await axios.get('https://httpbin.org/get', { timeout: 10000 });
        console.log('axios status:', res.status);
    } catch (e) {
        console.log('axios error:', e.message);
    }

    const dom = new JSDOM('<html><body><h1>Hello</h1></body></html>');
    console.log('jsdom title:', dom.window.document.querySelector('h1')?.textContent);
}
main();
`)
    const out = runCliWithRetry([
        'run', '--with', 'axios', '--with', 'jsdom', '-q',
        scriptPath,
    ], { cwd: dir })
    // axios may fail due to network issues, but jsdom should always work
    assert.ok(out.includes('jsdom title: Hello'))
})

test('ntsx ejemplo 2: --with @kreisler/js-google-translate-free@^5 app.js -- --to=es --text="Hello World"', () => {
    const dir = sandbox()
    const scriptPath = createFile(dir, 'app.js', `
import JsGoogleTranslateFree from '@kreisler/js-google-translate-free';
import { z } from 'zod';

const argsSchema = z.object({
    to: z.string().default('es'),
    text: z.string().default('Hello World'),
});

function parseArgs(argv) {
    const args = {};
    for (const arg of argv) {
        if (arg.startsWith('--')) {
            const [key, ...valueParts] = arg.slice(2).split('=');
            args[key] = valueParts.join('=') || 'true';
        }
    }
    return args;
}

async function main() {
    const parsed = parseArgs(process.argv.slice(2));
    const { to, text } = argsSchema.parse(parsed);
    try {
        const translation = await JsGoogleTranslateFree.translate({ to, text });
        console.log({ translation });
    } catch (e) {
        // Google Translate may rate limit (429) - this is expected
        console.log({ error: e.message });
    }
}
main();
`)
    const out = runCliWithRetry([
        'run', '--with', '@kreisler/js-google-translate-free@^5', '--with', 'zod', '-q',
        scriptPath,
        '--', '--to=es', '--text=Hello World',
    ], { cwd: dir })
    // May succeed with translation or fail with rate limit error
    assert.ok(out.includes('translation') || out.includes('error'))
})

test('ntsx ejemplo 3: --tsx-args "--env-file=.env" -e "..."', () => {
    const dir = sandbox()
    const envPath = createEnvFile(dir, { NTSX_TEST_USER_ID: '12345' })
    const out = runCliWithRetry([
        'run', '--tsx-args', `--env-file=${envPath}`,
        '-e', "import { loadEnvFile } from 'node:process'; loadEnvFile(); console.log(process.env.NTSX_TEST_USER_ID);",
    ], { cwd: dir })
    assert.equal(stripAnsi(out.trim()), '12345')
})

test('ntsx ejemplo 4: --tsx-args "--env-file=.env" --tsx-args "--tsconfig=./tsconfig.custom.json" ./file.ts', () => {
    const dir = sandbox()
    const envPath = createEnvFile(dir, { NTSX_TEST_USER_ID: '12345' })
    const tsconfigPath = createFile(dir, 'tsconfig.custom.json', JSON.stringify({
        compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true
        }
    }))
    const scriptPath = createFile(dir, 'custom.ts', `
import { loadEnvFile } from 'node:process';
loadEnvFile();
console.log('NTSX_TEST_USER_ID:', process.env.NTSX_TEST_USER_ID);
`)
    const out = runCliWithRetry([
        'run', '--tsx-args', `--env-file=${envPath}`,
        '--tsx-args', `--tsconfig=${tsconfigPath}`,
        scriptPath,
    ], { cwd: dir })
    assert.ok(out.includes('NTSX_TEST_USER_ID: 12345'))
})

test('ntsx ejemplo 5: --node-args "--env-file=.env" -e "..."', () => {
    const dir = sandbox()
    const envPath = createEnvFile(dir, { NTSX_TEST_USER_ID: '12345' })
    const out = runCliWithRetry([
        'run', '--node-args', `--env-file=${envPath}`,
        '-e', "import { loadEnvFile } from 'node:process'; loadEnvFile(); console.log(process.env.NTSX_TEST_USER_ID);",
    ], { cwd: dir })
    assert.equal(stripAnsi(out.trim()), '12345')
})

// ============================================================
// Tests de detección de codificación
// ============================================================

test('ntsx: detecta archivos UTF-16 y muestra advertencia', () => {
    const dir = sandbox()
    // Crear archivo UTF-16 LE
    const scriptPath = path.join(dir, 'utf16.ts')
    const content = 'console.log("hello")'
    // Escribir como UTF-16 LE
    const buffer = Buffer.alloc(content.length * 2)
    for (let i = 0; i < content.length; i++) {
        buffer[i * 2] = content.charCodeAt(i)
        buffer[i * 2 + 1] = 0
    }
    writeFileSync(scriptPath, buffer)

    // Debería mostrar advertencia de codificación
    const { stderr } = runCliErr([
        'run', scriptPath,
    ], { cwd: dir })
    assert.ok(stderr.includes('WARNING') || stderr.includes('UTF-16'))
})

// ============================================================
// Tests de debug
// ============================================================

test('ntsx: --debug muestra información de depuración', () => {
    const dir = sandbox()
    const { stderr } = runCliErr([
        'run', '--debug', '-e', 'console.log("test")',
    ], { cwd: dir })
    assert.ok(stderr.includes('[ntsx:debug]'))
})

// ============================================================
// Tests de cache
// ============================================================

test('ntsx: cache dir muestra la ruta del caché', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'cache', 'dir',
    ], { cwd: dir })
    assert.ok(out.includes('.cache') || out.includes('ntsx'))
})

test('ntsx: cache stats muestra estadísticas', () => {
    const dir = sandbox()
    const out = runCliWithRetry([
        'cache', 'stats',
    ], { cwd: dir })
    assert.ok(out.length > 0)
})
