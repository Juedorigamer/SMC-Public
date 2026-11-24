# SMC GUI (Electron)

Aplicación de escritorio para lanzar `recon.js` con una interfaz gráfica.

## Cómo abrirla

Desde la carpeta del proyecto:

```bat
node\npm.cmd run gui
```

O con el acceso directo **`SMC - GUI`** del escritorio.

## Qué hace

- Lanza `recon.js` como **proceso hijo** y muestra `stdout`/`stderr` en vivo.
- **Kill switch** que mata el árbol de procesos del hijo (`taskkill /T /F`) y
  solo reporta "terminado" cuando el proceso murió de verdad.
- **Guard de ventana horaria** en el proceso principal. La franja la define
  **`app/ventana-autorizada.json`** (archivo que la UI no puede escribir):
  mientras `from`/`until` sean `null` (sin franja autorizada definida), ninguna
  sesión remota puede iniciar. La UI solo muestra la franja; si sus campos no
  coinciden con el archivo, gana el archivo.
- **Objetivos locales exentos**: una conexión directa a `127.0.0.1`/`localhost`
  (el lab propio) no requiere franja autorizada. Vía ViaProxy SIEMPRE cuenta
  como producción (el proxy existe para alcanzar el servidor objetivo).
- **Instancia única**: una segunda ventana no lanza una segunda sesión.
- **Read-only por defecto**. `--allow-writes` solo se activa con la frase
  `ENTIENDO QUE ESTO MODIFICA ESTADO`.
- **Modo agresivo** con doble verificación: dos casillas + frase
  `ACEPTÓ RIESGO DE DETECCIÓN`.
- **ViaProxy**: botones para iniciar/detener el proxy local 26.3.
- **Generar informe**: ejecuta `report.js` sobre el JSON de la sesión (con
  timeout de 60 s para no trabar el botón).
- **Redacción**: los logs enmascaran `/login`, `/register` y sus alias; el
  volcado de `--autorun` no incluye la ruta del secreto; `recon.js` corre con
  `--redact`.
- **Bloqueo de navegación**: la ventana no navega ni abre pop-ups (evita que
  el preload se reinyecte en contenido no confiable). El renderer solo puede
  abrir rutas dentro del proyecto.

## Niveles de sondeo

| Nivel | Flags que envía |
|---|---|
| Mínimo | `--no-probe --no-tab` |
| Estándar | `--profile towny` (si la modalidad es Towny) + tab-complete base |
| Agresivo | Estándar + `--extra-probe "/money\|/baltop\|/warps\|/spawn\|/shop\|/ah"` + `--trace --packet-log` |

## Acceso directo vs ViaProxy

- **ON**: conecta al host/puerto configurados.
- **OFF**: conecta a `127.0.0.1:25577` (ViaProxy) y usa versión 26.1 contra el proxy.
  Si el puerto no está abierto, la app rechaza el inicio.

## Archivos

```
app/
├── main.js                  # proceso principal (IPC, spawn, guard, ViaProxy)
├── preload.js               # API segura para el renderer
├── ventana-autorizada.json  # franja autorizada (la lee SOLO el main; null = sin franja)
└── renderer/
    ├── index.html           # UI
    └── app.js               # lógica de la UI
```

## Pendiente

- Empaquetado con `electron-builder` para distribuir un `.exe` autónomo.
- Firma de código (si se distribuye fuera del equipo).
- Empaquetar `recon.js`, `node_modules` y el Node portátil como recursos.
