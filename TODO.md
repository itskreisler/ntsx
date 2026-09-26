# TODO - Auditoría ntsx

## Pendientes

### 1. `ntsx lock` — Genera lockfile para scripts y dependencias
- [ ] Verificar que genera lockfile correctamente
- [ ] Probar con script que tiene dependencias
- [ ] Probar con script sin dependencias
- [ ] Verificar formato del lockfile
- [ ] Probar que `ntsx run` usa el lockfile si existe

### 2. `ntsx tool run` — Ejecuta herramientas de desarrollo efímeras
- [ ] Verificar ayuda del subcomando
- [ ] Probar con una tool conocida (ej: `typescript`, `eslint`)
- [ ] Probar pasando argumentos a la tool
- [ ] Verificar que instala la tool efímeramente
- [ ] Verificar que no contamina el proyecto

### 3. Script metadata — Header inline con dependencias y versión de Node
- [ ] Probar script con header `/// ntsx` y dependencias
- [ ] Probar script con header `/// ntsx` y versión de Node
- [ ] Verificar que no necesita `--with` si está en el header
- [ ] Verificar que no necesita `--node` si está en el header
- [ ] Probar script sin header (debe funcionar igual)

### 4. Manejo de errores — Casos edge y señales (SIGINT, SIGTERM)
- [ ] Probar script que no existe
- [ ] Probar script con sintaxis inválida
- [ ] Probar con dependencia inexistente
- [ ] Probar con versión de Node inexistente
- [ ] Probar interrupción con Ctrl+C (SIGINT)
- [ ] Verificar que se restaura `node_modules` después de error
- [ ] Verificar que se restaura `node_modules` después de SIGINT

## Completados

- [x] `ntsx run` — Todos los flags funcionan correctamente
- [x] `ntsx cache` — Todos los subcomandos funcionan correctamente
