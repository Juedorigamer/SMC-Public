# SMC — Auditoría black-box de servidores Minecraft

Reconocimiento y auditoría **sin OP, sin consola y sin archivos del servidor**:
SMC se conecta como un cliente más y aprende de un servidor solo con lo que
cualquier jugador puede ver. Incluye GUI de escritorio, herramientas de
análisis offline y una capa para LLM: un **servidor MCP** y un **digest**
compacto para que un agente (OpenCode, Claude, etc.) analice un servidor.

> **Herramienta para auditorías AUTORIZADAS.** No la apuntes a servidores
> ajenos: conseguí autorización escrita antes de usarla (plantilla en
> `AUTORIZACION-PLANTILLA.md`). Muchos servidores prohíben los sondeos
> incluso a su propio staff. El toolkit está diseñado alrededor de ese
> principio: sin ventana horaria autorizada no conecta, y el modo read-only
> es el default.

---

## 1. Qué incluye

| Pieza | Qué hace |
|---|---|
| `recon.js` | motor de reconocimiento (versión, brand, plugins, comandos, GUIs, economía) |
| `report.js` | convierte el JSON de una corrida en un informe Markdown |
| `app/` + `gui.cmd` | GUI Electron con kill switch, guard de ventana horaria y redacción de PII |
| `mcp-server.js` | **servidor MCP (stdio)**: expone el toolkit a agentes LLM, todo read-only |
| `tools/llm-digest.js` | condensa una corrida en un digest compacto para contexto de LLM |
| `tools/` | suite de prueba (coinflip, auction house, kits, packet-race) + análisis offline (reconcile, cve-check, economía, plugins) |
| `skills/`, `EXPLOIT-METHODS.md`, `EXPLOIT-DEV.md` | metodología y playbooks de hipótesis de duplicación |
| `research/` | corpus de referencia (anti-dupes, parches, primitivas) con evaluaciones propias |
| `lab/` | servidor Paper local de práctica (solo configs; el jar se descarga aparte) |

## 2. Instalación

```bat
git clone https://github.com/Juedorigamer/SMC-Public.git SMC
cd SMC
npm install
```

Requisitos: Node 18+ y (opcional) Java 8+ para [ViaProxy](https://github.com/ViaVersion/ViaProxy)
(si el servidor corre una versión más nueva que la que habla el cliente).
Para el lab local: descargá `paper.jar` (Paper 1.21.x) y ponelo en `lab/`.

## 3. Uso rápido (CLI)

```bat
REM paso 0: ping público (riesgo cero, no necesita cuenta)
node recon.js --host mc.ejemplo.com --ping-only

REM recon autenticado read-only, con ventana autorizada
node recon.js --host mc.ejemplo.com --username MiAuditora ^
  --account MiAuditora ^
  --window-from 2026-11-23T14:00:00-03:00 --window-until 2026-11-23T15:00:00-03:00 ^
  --login-file .secrets/miauditora.txt --redact --out out/mi-corrida.json

REM informe y digest
node report.js out/mi-corrida.json
node tools/llm-digest.js out/mi-corrida.json
```

Controles de alcance (todos activos por defecto):

| Flag | Efecto |
|---|---|
| `--window-from/--window-until` | **obligatorias para conectar el bot**; ISO **con zona horaria**; se revalidan en cada comando |
| (sin `--allow-writes`) | read-only: bloquea comandos que modifican estado (deny-list amplia + namespaces `plugin:cmd` normalizados) |
| `--max-commands`, `--min-interval` | tope y pacing de sondeos |
| `--redact` | reemplaza nombres de jugadores por `[jugador-N]` |
| `--abort-lag` | desconecta ante latencia anormal sostenida |

Las tools en vivo comparten guardas vía `tools/lib/mc.js`:
`requireAccount` (opcionalmente restringida con `tools/lib/accounts.txt`),
`requireWindow` y `requireWrites` (flag literal, sin valor).

## 4. GUI

```bat
npm run gui
```

- Guard de ventana horaria **en el proceso principal**, con fuente de verdad
  en `app/ventana-autorizada.json` (la UI no puede autorizar por sí sola).
  Mientras `from`/`until` sean `null`, ninguna sesión remota puede iniciar.
- Read-only por defecto; escrituras solo con frase de confirmación.
- Kill switch real (espera la muerte del árbol de procesos), instancia única,
  logs con secretos enmascarados, PII redactada.
- Conexiones directas a `127.0.0.1` (lab propio) no requieren franja.

## 5. Integración con LLM

Dos caminos, pensados para que un agente **aprenda un servidor**:

### 5.1 Digest manual

```bat
node tools/llm-digest.js out/mi-corrida.json
node tools/llm-digest.js out/a.json out/b.json --out out/digest.md
```

Produce un Markdown compacto (versión, brand, backends, namespaces de
plugins, comandos visibles, economía capturada, GUIs) pensado para pegar
como contexto de un LLM.

### 5.2 Servidor MCP

`mcp-server.js` expone 7 herramientas sobre stdio, **todas read-only**:

| Tool | Qué hace |
|---|---|
| `ping_server` | ping público (versión, MOTD, jugadores) |
| `recon_readonly` | corre `recon.js` read-only (exige ventana autorizada y cuenta) y devuelve el digest |
| `llm_digest` | digest de una o varias corridas |
| `plugin_list` | lista de plugins/namespaces desde una corrida |
| `cve_check` | cruza `Plugin=versión,...` contra `tools/vulndb.json` (AFFECTED/OK/UNKNOWN) |
| `reconcile_inventories` | diff de snapshots antes/después de una prueba |
| `econ_summary` | resumen del dataset de precios del shop |

Las **pruebas de escritura** (dupe/duplicación: `cf-test`, `ah-test`,
`kit-test`, `packet-race`) **no están expuestas por MCP**: son solo CLI y
requieren autorización explícita (`--allow-writes` + ventana). El login nunca
viaja por argumentos: solo como ruta de archivo dentro de `.secrets/`.

**Config en OpenCode** (`opencode.json` del proyecto):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "smc": {
        "type": "local",
        "command": ["node", "mcp-server.js"],
        "cwd": "."
      }
    }
  }
}
```

O por CLI: `opencode mcp add smc -- node mcp-server.js`

El servidor devuelve `instructions` al inicializar (reglas de uso), y
cualquier cliente MCP estándar (stdio) puede consumirlo igual:

```bat
npm run mcp
```

## 6. Lab local de práctica

```bat
cd lab
java -jar paper.jar --nogui
```

Queda en `127.0.0.1:25599`, `online-mode=false`, **solo localhost** y con
whitelist (cuenta `Auditor` — ver `lab/whitelist.json`). Ideal para probar el
toolkit sin tocar producción.

## 7. Ética y alcance

- Autorización **escrita** antes de cualquier prueba (`AUTORIZACION-PLANTILLA.md`).
- Ventana horaria acordada: las tools la exigen y la revalidan.
- Sin evasión de anti-bot, sin cambio de cuenta/IP tras una detección.
- Sin pruebas de carga ni flooding (tope de 4 clics en packet-race).
- Sin interacción con terceros durante las pruebas.
- Hallazgo → reporte al dueño, con evidencia reproducible. No se explota.
- Ítems/dinero de prueba: mínimo, con rollback acordado, nada valioso.

## 8. Limitaciones

- El árbol de comandos llega **filtrado por permisos** (Paper 1.20.5+):
  un conteo bajo no significa "sin plugins".
- Tab-complete se corta en ~1000 sugerencias (`--tab-sweep` barre por prefijo).
- No detecta plugins sin superficie visible (anticheats, loggers).
- El estado server-side no se puede confirmar desde un solo cliente:
  usá relog + snapshot + reproducción (`tools/reconcile.js`).

## 9. Estructura

```
recon.js  report.js  mcp-server.js     motor + informe + MCP
run.cmd  report.cmd  gui.cmd           lanzadores
app/                        GUI Electron (main/preload/renderer)
tools/   lib/mc.js          guardas compartidas (cuenta/ventana/escrituras)
         llm-digest.js      digest para LLM
         gen-audit-report.js informe consolidado por argumentos
         cf-test/ah-test/kit-test/packet-race  suite de pruebas de escritura
         reconcile/cve-check/plugin-list/econ-* análisis offline
research/                   corpus de referencia con evaluaciones (INDEX.md)
skills/                     playbooks por técnica
lab/                        configs del Paper local de práctica
probes/                     listas de sondeos read-only reutilizables
```

## 10. Licencia

Ver `LICENSE`.
