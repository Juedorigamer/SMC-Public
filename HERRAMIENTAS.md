# Lista de herramientas — SMC

**Todas las rutas son relativas a la raíz del proyecto.** Node 18+ (si usás los
`.cmd`, asumimos `node` en PATH; sino llamá `node recon.js` directo).

---

## Herramientas principales

| Herramienta | Archivo | Qué hace |
|---|---|---|
| **Recon** | `recon.js` | Reconocimiento black-box: status ping, login, cambio de backend, árbol de comandos, tab-complete, GUIs, proxies, resource packs. |
| **GUI (app)** | `app/` | Aplicación Electron: lanza `recon.js`, logs en vivo, kill switch, guard de ventana, ViaProxy e informes. |
| **Informes** | `report.js` | Convierte un JSON de `out/` en un informe Markdown. |
| **Servidor MCP** | `mcp-server.js` | Expone el toolkit a agentes LLM por stdio (todo read-only). |
| **Digest LLM** | `tools/llm-digest.js` | Condensa una corrida en un Markdown compacto para contexto de LLM. |
| **Lanzador recon** | `run.cmd` | Atajo para `recon.js`. |
| **Lanzador informes** | `report.cmd` | Atajo para `report.js`. |
| **GUI beta (mockup)** | `gui-beta.html` | Interfaz visual **simulada** (sin conexión real). Referencia de diseño. |

## Sondas y análisis

| Herramienta | Archivo | Qué hace |
|---|---|---|
| **Sonda Towny** | `tools/towny-probe.js` | Diagnóstico de la fase de configuración de Towny, modos de resource pack, freeze, detección de rebote. **Guardas:** cuenta y ventana obligatorias. |
| **Test /cf** | `tools/cf-test.js` | Prueba controlada de reembolso doble en plugins de coinflip: crea un coinflip PRIVADO (verificado antes de crear; un "unknown" aborta), cancela con delay y compara saldos (incluye la lectura tardía). **Guardas:** ventana+cuenta+`--allow-writes`. |
| **Test Auction House** | `tools/ah-test.js` | `check`, `nan`, `negative`, `list-leave` (M1/M3). Lore limpio de `§`, slot de hotbar libre, validaciones numéricas y evidencia de kicks/login. |
| **Test Kit** | `tools/kit-test.js` | Cooldown bypass por relog / cambio de backend (M4). El modo `backend` hace el flip **dentro de la misma conexión** (mide el efecto sin relog). Sin ítem en ningún snapshot no concluye. |
| **Packet race** | `tools/packet-race.js` | Reorden/delay de clics crudos en una GUI (M5). Máx. 4 clics, sin flooding. Usa los campos reales del protocolo (`mouseButton`/`cursorItem`) y el `stateId` trackeado; `--reorder` invierte también los delays y verifica ventana abierta por clic. |
| **Version probe** | `tools/version-probe.js` | Recolecta versiones de plugins (read-only). Solo acepta comandos whitelisted; cualquier otro exige `--allow-writes`. |
| **CVE check** | `tools/cve-check.js` | Cruza versiones contra `tools/vulndb.json` (offline). Marca AFFECTED/OK/UNKNOWN y muestra la confianza de cada entrada. |
| **Reconcile** | `tools/reconcile.js` | Compara dos snapshots de inventario y marca fantasmas/over-stacks (offline). Validación **por slot** y con lado before/after explícito. |
| **Lista de plugins** | `tools/plugin-list.js` | Genera un Markdown con todos los plugins/namespaces detectados en un JSON. |
| **Informe consolidado** | `tools/gen-audit-report.js` | Consolida barrido(s), corridas de `/cf` y lista de plugins en un informe único; todo por argumentos, tolera archivos faltantes. |
| **Precios de shop** | `tools/shop-prices.js` | Normaliza las ventanas de `/shop` a un dataset de precios (gramática de dinero con decimales). |
| **Resumen económico** | `tools/econ-summary.js` | Top de ventas, duplicados entre categorías, spreads anómalos. |
| **Sección económica** | `tools/gen-econ-section.js` | Genera la sección económica del informe desde el dataset. |
| **Zipinfo** | `tools/zipinfo.js` | Inspecciona el contenido de un resource pack `.zip`. |
| **Decode windows** | `tools/decode-windows.js` | Decodifica ventanas de GUI capturadas. |

## Guardas compartidas (`tools/lib/mc.js`)

Todas las tools en vivo pasan por las mismas guardas antes de conectar:

1. **Cuenta** (`requireAccount`): no vacía; si existe `tools/lib/accounts.txt`
   (copia el ejemplo `accounts.txt.example`), solo acepta las cuentas listadas.
2. **Ventana** (`requireWindow`): `--window-from/--window-until` ISO **con zona
   horaria**, vigente al momento de conectar.
3. **Escrituras** (`requireWrites`): flag literal `--allow-writes` para las
   tools que modifican estado.
4. **Protocolo**: `rawClick` usa `mouseButton`/`cursorItem` y el `stateId`
   trackeado; `--allow-writes false` (string) no pasa.

## Ejemplos (host de ejemplo; usá el tuyo)

```bat
REM ping público
node recon.js --host mc.ejemplo.com --ping-only

REM recon read-only autenticado
node recon.js --host mc.ejemplo.com --username MiAuditora --account MiAuditora ^
  --window-from 2026-11-23T14:00:00-03:00 --window-until 2026-11-23T15:00:00-03:00 ^
  --login-file .secrets/miauditora.txt --redact --out out/mi-corrida.json

REM lista de plugins + digest para un LLM
node tools/plugin-list.js out/mi-corrida.json
node tools/llm-digest.js out/mi-corrida.json

REM versión de plugins contra la base local de CVEs
node tools/version-probe.js --account MiAuditora ^
  --window-from 2026-11-23T14:00:00-03:00 --window-until 2026-11-23T15:00:00-03:00 ^
  --login-file .secrets/miauditora.txt --out out/versiones.json
node tools/cve-check.js --from out/versiones.json

REM prueba de duplicación (SOLO con autorización escrita; lee AUTORIZACION-PLANTILLA.md)
node tools/ah-test.js --mode list-leave --price 1 --allow-writes ^
  --account MiAuditora --login-file .secrets/miauditora.txt ^
  --window-from <ISO> --window-until <ISO> --out out/ah-01.json
node tools/reconcile.js out/ah-01.json out/ah-02.json
```

## Documentación

| Documento | Archivo | Contenido |
|---|---|---|
| **Autorización** | `AUTORIZACION-PLANTILLA.md` | Plantilla del acuerdo de auditoría (partes, franja, reglas, rollback). |
| **Runbook** | `RUNBOOK-AUDITORIA.md` | Orden sugerido de una auditoría completa, de read-only a pruebas de duplicación. |
| **Métodos** | `EXPLOIT-METHODS.md` | M1–M11: recopilación y derivación de hipótesis de duplicación. |
| **Desarrollo** | `EXPLOIT-DEV.md` | Plan de desarrollo de las herramientas y decisiones. |
| **Research** | `research/INDEX.md` | Índice del corpus de referencia con evaluaciones y fuentes. |
| **Playbooks** | `skills/*.md` | Una técnica por archivo (save-race, packet-delay, cooldown…). |
| **GUI** | `app/README.md` | Detalles de la app Electron. |

## Atajos

| Archivo | Qué abre |
|---|---|
| `gui.cmd` | La GUI Electron (`npm run gui` equivalente) |
| `run.cmd` | `recon.js` con los argumentos que le pases |
| `report.cmd` | `report.js` |
| `lab/start.cmd` | El servidor Paper del lab local |
