# Snippets — código de referencia

Fragmentos destilados de la investigación. **Ninguno está conectado al bot**; son referencia para implementar las herramientas propuestas en `EXPLOIT-DEV.md`.

| Archivo | Origen / propósito |
|---|---|
| `packet-race.js` | Raza de packet-delay (M1/M5): `window_click` crudo con delay/reorden/flush. |
| `packet-delay-queue.java` | Patrón `du-addon` (cola de C2S + flush al desactivar). |
| `reconcile.js` | Reconciliación de inventario (M8 / detección). Solo lectura. |
| `exposure-check.js` | Chequeo pasivo de exposición (RCON/Query/Dynmap). Requiere OK antes de usar. |
| `clear-active-item.java` | Patrón BundleDupeV3Fix (limpiar estado activo en quit). |
| `click-rate-limit.java` | Patrón ExploitShield (rate-limit de clics). |

> Los `.java` son para entender la defensa, no para compilar en el bot. Los `.js` son plantillas de las herramientas propuestas.
