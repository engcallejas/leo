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
   **requerimiento refinado** + una lista **ordenada de pasos**. Puedes editar
   todo a mano.
3. **Crear subtasks en ClickUp** (opcional): cada paso se crea como subtask bajo
   la tarea padre.
4. **Encolar / Programar**: los pasos se ejecutan **uno a uno, en orden**. Cada
   paso recibe el spec global + los **resúmenes de los pasos previos** (contexto
   acumulativo); al terminar cada subtask se escribe un **comentario en ClickUp**
   con el resultado. Si un paso falla, la orquestación se detiene.

> El refinamiento usa tu suscripción/API key igual que un run normal — lo
> disparas tú con el botón **Refinar**.

## Estructura

```
src/
  lib/
    db.ts / schema.ts      SQLite (libsql) + migraciones
    repo.ts / plan-repo.ts CRUD + mappers (tareas/runs y planes/pasos)
    claude-auth.ts         auth (suscripción / API key) + modelos + env saneado
    boot.ts                bootstrap (migración + scheduler)
    integrations/          providers Sentry + ClickUp (poll / resolve / subtasks)
    orchestrator/          prompt, runner, planner (refinamiento),
                           plan-runner (orquestación) y scheduler
  app/                     UI + rutas API (incl. /plans y /api/plans)
Dockerfile, docker-compose.yml, .env.example
data/                      leo.db + logs/   (gitignored)
```

## Seguridad

- **Local-only, sin autenticación de la app.** No lo expongas a una red pública.
- Los tokens (Sentry/ClickUp y el OAuth token) se guardan en `data/leo.db` en
  texto plano; `data/` y `.env` están en `.gitignore`.
- `bypassPermissions` deja a Claude ejecutar herramientas sin confirmación:
  combínalo con `disallowedTools` y reglas claras en el prompt del proyecto.
