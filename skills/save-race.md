# Skill — Save race (disconnect mid-transaction / confirm-GUI)

**Métodos:** M1, M2 · **Herramienta base:** `tools/cf-test.js` / `packet-race.js`

## Causa raíz

El plugin quita el ítem del inventario y lo persiste (DB/redis/archivo) en **dos pasos no atómicos**. Si el jugador se desconecta entre el paso 1 y el 2, el ítem queda en dos lugares (o el reembolso se aplica dos veces).

**Variante confirm-GUI:** el plugin abre una GUI de confirmación y no bloquea otras operaciones sobre el mismo ítem; otra acción (compra, expiración, otro clic) ocurre mientras la confirmación está abierta, y al confirmar ambos caminos se completan.

## Señales en el objetivo

- Comandos tipo "quitar de inventario → escribir en almacén": `/ah sell`, `/ec`, `/petinv`, mochila, crafteo, trade.
- GUIs de confirmación: cancelar listado, reclamar recompensa, recoger expirado.

## Prueba black-box (M1)

1. Snapshot inventario + saldo.
2. Sostener un ítem (bread x16) y enviar `/ah sell <precio>`.
3. Desconectar a los N ms (send-and-quit).
4. Reentrar y comparar: ¿el ítem está en inventario **y** en “Tus Subastas”?

## Prueba black-box (M2)

1. Cancelar un listado deteniéndose en la confirmación.
2. Disparar el segundo camino (expiración natural o claim de “Contenedor de Recolección”).
3. Confirmar y verificar si ambos caminos entregaron el ítem.

## Límites

- No flooding; una acción por corrida.
- Snapshot + relog + reproducción antes de confirmar.
- Rollback del supervisor.

## Referencia

- `BundleDupeV3Fix`: `clearActiveItem()` en quit (el patrón a detectar).
- `ExploitShield` `PlayerDuplicationListener` / `ContainerEntityChunkDuplicationListener`.
