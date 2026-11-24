# Skill — Bypass de cooldown / timestamp (relog, backend, mundo)

**Método:** M4 · **Herramienta:** `recon.js --click-slot` + relog, o `kit-test.js`

## Causa raíz

El cooldown se guarda solo en memoria de sesión (o en un hash por sesión/mundo). Relog, cambio de backend (`/server`) o cambio de mundo lo resetea.

## Señales en el objetivo

- Kits (`/kitpreview`): reclamo con cooldown.
- Daily rewards, vote, battlepass claim.
- `/cf` cooldown de cancelación.

## Prueba

1. Reclamar kit/recompensa.
2. **Relog** y reclamar otra vez (misma sesión ya vimos que bloquea en kits → probar con relog).
3. **Cambiar backend** (`/server lobby` → `/server towny`) y reclamar de nuevo.
4. Comparar inventario/saldo.

## Verificación

- `reconcile.js` para el delta de ítems; saldo antes/después.
- Reproducir en una segunda corrida.

## Límites

- No interactuar con terceros.
- Espaciar reclamos para no disparar heurísticas de adquisición (TMAR).

## Referencia

- `BetterAntiDupe` "acquisition-rate abuse (TMAR)".
- Kits de CMI: cooldowns persistentes vs por-sesión.
