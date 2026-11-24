# Runbook de auditoría — orden sugerido

**Precondición:** autorización escrita completada (`AUTORIZACION-PLANTILLA.md`),
cuenta de prueba creada, supervisor asignado y ventana horaria acordada.
Todo lo que toca red pasa por las guardas: cuenta (`tools/lib/accounts.txt`
opcional), ventana ISO con zona horaria, y `--allow-writes` para escrituras.

> Ejemplos con `mc.ejemplo.com` / `MiAuditora` / `2026-11-23T14:00:00-03:00`.
> Reemplazalos por tu objetivo, tu cuenta y tu franja real.

---

## 0. Preparación offline

- Copiá `tools/lib/accounts.txt.example` → `accounts.txt` y listá tu cuenta.
- Guardá la contraseña en `.secrets/miauditora.txt` (UTF-8, una línea, sin BOM).
- `npm install` si no lo hiciste.

## 1. Ping público (riesgo cero)

```bat
node recon.js --host mc.ejemplo.com --ping-only
```

Anotá versión y protocolo. Si el backend corre una versión más nueva que la
que habla el cliente, prepará ViaProxy (ver README §2).

## 2. Recon read-only

```bat
node recon.js --host mc.ejemplo.com --username MiAuditora --account MiAuditora ^
  --window-from 2026-11-23T14:00:00-03:00 --window-until 2026-11-23T15:00:00-03:00 ^
  --login-file .secrets/miauditora.txt --redact --profile towny --out out/r1.json
```

Analizá el resultado:

```bat
node tools/llm-digest.js out/r1.json          # resumen compacto
node tools/plugin-list.js out/r1.json         # tabla de plugins/namespaces
node report.js out/r1.json                    # informe completo
```

O pedile a tu agente LLM que lo haga (servidor MCP: `ping_server` →
`recon_readonly` → `llm_digest` / `plugin_list`).

## 3. Versiones y exposición

```bat
REM versiones de plugins (comandos whitelisted read-only)
node tools/version-probe.js --account MiAuditora ^
  --window-from 2026-11-23T14:00:00-03:00 --window-until 2026-11-23T15:00:00-03:00 ^
  --login-file .secrets/miauditora.txt --out out/versiones.json

REM contra la base local de vulnerabilidades
node tools/cve-check.js --from out/versiones.json
```

## 4. Economía del shop

```bat
REM capturar categorías del shop (navegación read-only de GUIs)
node recon.js ... --only-extra --extra-probe-file probes/shop-cats.txt ^
  --click-window /shop --click-slots 20,21,22 --max-windows 30 --out out/shop.json

node tools/shop-prices.js out/shop.json out/sky-shop-prices.json
node tools/econ-summary.js out/sky-shop-prices.json
```

## 5. Pruebas de duplicación (SOLO con autorización de escritura)

Una hipótesis por corrida; snapshot antes/después; relog; reproducir.
Ítems sin valor (tierra, pan, palos). Ver `EXPLOIT-METHODS.md` (M1–M11).

```bat
REM M3: abuso numérico en /ah sell
node tools/ah-test.js --mode nan --allow-writes --account MiAuditora ^
  --login-file .secrets/miauditora.txt --window-from <ISO> --window-until <ISO> ^
  --out out/ah-nan-01.json

REM M1: list-and-leave
node tools/ah-test.js --mode list-leave --price 1 --allow-writes ... --out out/ah-ll-01.json

REM M4: cooldown de kit (relog y backend por separado)
node tools/kit-test.js --relog-mode relog --allow-writes ... --out out/kit-relog.json
node tools/kit-test.js --relog-mode backend --allow-writes ... --out out/kit-backend.json

REM M5: clics crudos con delay/reorden (máx 4)
node tools/packet-race.js --open "/cf" --clicks "22:1:0:0,22:1:0:80" --allow-writes ... ^
  --out out/cf-race.json

REM /cf: reembolso doble por cancelación
node tools/cf-test.js --allow-writes --amount 100 --delay 100 ^
  --login-file .secrets/miauditora.txt --window-from <ISO> --window-until <ISO> ^
  --out out/cf-01.json
```

**Verificación del dupe** (antes de declarar confirmado):

```bat
node tools/reconcile.js out/antes.json out/despues.json
```

Marca AUMENTOs y stacks ilegales **por slot**; un delta que no aparece
en `reconcile` tras relog NO es un dupe.

## 6. Informe final

```bat
node tools/gen-audit-report.js --sweep out/r1.json ^
  --cf out/cf-01.json --plugins out/plugins-<fecha>.md ^
  --host mc.ejemplo.com --account MiAuditora ^
  --window "2026-11-23T14:00:00-03:00 -> 2026-11-23T15:00:00-03:00" ^
  --out out/informe-final.md
```

## 7. Criterios de aborto (en cualquier punto)

- Fin de la franja (las tools lo hacen solas).
- Kick, alerta o anomalía.
- Cualquier interacción no prevista con terceros.
- El monto/ítem supera lo acordado.
- Login no verificado (`meta.loginVerified` en el JSON).
