# Leo — Orquestador local de tareas para Claude Code

Leo conecta tus repos locales con fuentes de eventos (**Sentry** y **ClickUp**)
y, cuando aparece una tarea o un issue, ejecuta **Claude Code** dentro del repo
correspondiente para resolverlo: respeta el `CLAUDE.md` y los MCP del proyecto,
abre un PR y (opcional) marca el issue de origen como resuelto.

Es **local-only**, sin login de la app. Todo el estado vive en `./data`
(SQLite + logs).

---

## Qué hace

- **Pull-based:** un poller revisa cada N segundos Sentry/ClickUp y convierte
  los issues/tareas en tareas de Leo (con deduplicación).
- **Ejecuta `claude` headless** con la carpeta del repo como `cwd` → respeta
  automáticamente su `CLAUDE.md`, su `.mcp.json` y las validaciones por MCP
  (Supabase, Playwright, etc.).
- **Suscripción o API key:** por defecto usa tu **suscripción** de Claude
  (Pro/Max); también puedes usar una **API key de Anthropic**. Global con
  override por proyecto, y los modelos se eligen de una lista.
- **Configurable por proyecto:** prompt de reglas (puede / debe / no puede /
  no debe), branch base y destino, modo de permisos, auto-mode, herramientas
  permitidas, y "marcar el issue como resuelto al terminar".
- **Planeación:** parte de un issue/tarea, **refina** el requerimiento con el
  contexto real del repo, lo descompone en **pasos**, los empuja a ClickUp como
  subtasks y los **orquesta en orden pasando contexto acumulado** entre sesiones.
- **MCPs por proyecto:** servidores MCP (stdio/http/sse) que se inyectan en
  planeación y/o desarrollo para mejorar outputs y validaciones.
- **Hooks por proyecto:** objeto `hooks` de Claude Code vía `--settings` para
  guardas/validaciones automáticas en las ejecuciones de desarrollo.
- **Documentos de requerimientos (SDD/AIDLC):** globs de `.md` que se inyectan
  como fuente de verdad en el contexto, con visor de Markdown en la UI.
- **Preguntas interactivas:** un MCP propio (`leo`) deja que Claude pause y te
  pregunte desde la UI del run (`ask_user` / `request_approval`) en vez de asumir.
- **Roles de fuentes:** cada lista/proyecto es de *desarrollo*, *planeación* o
  *ambos* — el auto-run y el selector de planes usan listas distintas.
- **Runs robustos:** cada ejecución corre desacoplada y **sobrevive a reinicios**
  de Leo. La UI muestra la transcripción en vivo, el costo y los turnos.

## Cómo funciona

```
Sentry / ClickUp ──poll cada N s──► crea tareas ──► encola (según auto-mode)
                                                      │
                                                      ▼
   claude -p "<prompt>" --output-format stream-json   (cwd = repo del proyecto)
                                                      │
                                                      ▼
              log por run ──► UI en vivo (SSE) ──► al terminar: PR + (opc.) resolver issue
```

---

## Requisitos

- **Node 20+**
- **Claude Code CLI** autenticado con tu **suscripción** (`claude auth status`
  debe mostrar tu plan).
- (Opcional) tokens de **Sentry** y/o **ClickUp** si vas a usar esas fuentes.

## Levantarlo en local (rápido)

```bash
npm install
npm run dev          # http://localhost:3000
```

Producción:

```bash
npm run build && npm start   # http://localhost:3000
```

La base de datos y el esquema se crean solos en `./data` la primera vez. El
poller arranca al abrir la app y sigue mientras el servidor esté vivo.

## Levantarlo con Docker

```bash
cp .env.example .env          # edita REPOS_DIR y CLAUDE_CODE_OAUTH_TOKEN
docker compose up --build     # http://localhost:3000
```

- **`REPOS_DIR`** (carpeta del host con tus repos) se monta en **`/repos`** →
  en cada proyecto usa `repo_path = /repos/<nombre-del-repo>`.
- **`CLAUDE_CODE_OAUTH_TOKEN`**: genéralo en una máquina con tu suscripción con
  `claude setup-token`.
- La imagen incluye `claude`, `git` y `gh`, corre como usuario no-root y puede
  alcanzar servicios del host vía `host.docker.internal`.

## Autenticación (suscripción de Claude, no API key)

Leo solo ejecuta con tu suscripción. Antes de cada run valida
`claude auth status` y exige una sesión de suscripción.

- **En local (macOS):** en **Ajustes → Autenticación** pulsa
  *"Autenticar en Terminal"* (o corre `claude auth login`). Leo lo detecta solo.
- **En Docker / headless:** genera el token con `claude setup-token` y pégalo en
  **Ajustes** o ponlo como `CLAUDE_CODE_OAUTH_TOKEN` en `.env`.

---

## Uso

1. **Integraciones** → conecta Sentry y/o ClickUp (botón *Probar conexión*).
2. **Proyectos** → *+ Nuevo proyecto*: elige el repo con **📁 Examinar**, define
   el prompt de reglas, branch destino, modo de permisos y las **fuentes** que lo
   alimentan. Activa *auto-mode* cuando quieras que corra solo.
3. **Ajustes** → intervalo de polling, runs concurrentes, ruta del binario
   `claude`, y el interruptor **Auto-run global**.
4. **Ejecuciones** → clic en un run para ver la transcripción completa (texto de
   Claude, herramientas, resultado, costo y turnos).

> Para auto-mode usa el modo de permisos `acceptEdits` o `bypassPermissions`:
> en modo headless no hay forma de responder prompts de permiso.

## Planeación (refinamiento + orquestación)

Para trabajo más grande que una sola corrida, usa **Planeación**:

1. **Planeación → + Nueva planeación**: elige un proyecto y el origen — una
   tarea de ClickUp / issue de Sentry ya jalado, o un seed **manual**.
2. **Refinar**: Leo corre `claude` en **modo solo-lectura** dentro del repo
   (bloquea Edit/Write/Bash) para entender el código real y devuelve un
   **requerimiento refinado** + una lista **ordenada de pasos**. Puedes seguir
   el **análisis en vivo** (qué archivos lee) y editar todo a mano.
   - **Imágenes:** adjunta mockups/capturas al plan; Claude las lee (con la tool
     `Read`) durante el refinamiento y en cada paso.
3. **Crear subtasks en ClickUp** (opcional): cada paso se crea como subtask bajo
   la tarea padre.
4. **Encolar / Programar**: los pasos se ejecutan **uno a uno, en orden**. Cada
   paso recibe el spec global + los **resúmenes de los pasos previos** (contexto
   acumulativo); al terminar cada subtask se escribe un **comentario en ClickUp**
   con el resultado. Si un paso falla, la orquestación se detiene.

> El refinamiento usa tu suscripción/API key igual que un run normal — lo
> disparas tú con el botón **Refinar**.

## Calidad: MCPs, hooks y documentos de requerimientos

En cada proyecto (Proyectos → editar) puedes configurar:

- **Servidores MCP** (stdio/http/sse, con env/headers) y marcar si aplican a
  **planeación** y/o **desarrollo**. Leo escribe un `.mcp.json` por run y pasa
  `--mcp-config`; sus tools se autorizan solas. *Estricto* ignora el `.mcp.json`
  del repo.
- **Hooks**: pega el objeto `hooks` de Claude Code (PreToolUse/PostToolUse/…).
  Se aplica con `--settings` en las ejecuciones de desarrollo — útil para correr
  linters/tests como guarda automática.
- **Documentos de requerimientos**: globs de `.md` (SDD/AIDLC: `specs/**/*.md`,
  `.aidlc/**`, …). Su contenido se inyecta como fuente de verdad en planeación y
  desarrollo, y los puedes **leer renderizados** desde el detalle del plan.

## Preguntas interactivas

Activa *"Permitir que Claude haga preguntas"* en el proyecto y Leo inyecta un MCP
propio (`leo`, en `scripts/leo-mcp-server.mjs`) con `ask_user` y
`request_approval`. Cuando Claude las llama, el run **se pausa** y aparece un
formulario en su página; al responder, el agente continúa. Funciona aun con runs
desacoplados (el MCP habla con Leo por HTTP local y sobrevive reinicios).

## Estructura

```
src/
  lib/
    db.ts / schema.ts      SQLite (libsql) + migraciones
    repo.ts / plan-repo.ts CRUD + mappers (tareas/runs/interacciones y planes)
    claude-auth.ts         auth (suscripción / API key) + modelos + env saneado
    specs.ts               recolecta los .md de requerimientos (globs)
    boot.ts                bootstrap (migración + scheduler)
    integrations/          providers Sentry + ClickUp (poll / resolve / subtasks)
    orchestrator/          prompt, runner, planner, plan-runner, scheduler,
                           run-config (MCP/hooks/settings por run)
  app/                     UI + rutas API (planes, specs, interacciones, fs)
scripts/leo-mcp-server.mjs MCP propio: ask_user / request_approval
Dockerfile, docker-compose.yml, .env.example
data/                      leo.db + logs/   (gitignored)
```

## Seguridad

- **Local-only, sin autenticación de la app.** No lo expongas a una red pública.
- Los tokens (Sentry/ClickUp y el OAuth token) se guardan en `data/leo.db` en
  texto plano; `data/` y `.env` están en `.gitignore`.
- `bypassPermissions` deja a Claude ejecutar herramientas sin confirmación:
  combínalo con `disallowedTools` y reglas claras en el prompt del proyecto.
