# BetterAntiDupe — evaluación de funcionamiento

**Repo:** `ESMP-FUN/BetterAntiDupe` · **Tipo:** detector forense de duplicación (Paper/Folia/Spigot, 1.21.x y 26.x).

## Qué hace

Dos capas:
1. **Bloquea de raíz** los duper clásicos (rail, carpet, TNT, gravity; phantom-GUI container dupes; restart dupers).
2. **Chain of Custody ledger**: registro append-only de cada movimiento de ítems, reconciliado contra lo que cada jugador realmente tiene. Si no cuadra, alerta antes de que el dupe se propague.

## Detecciones que documenta (ledger)

balance reconciliation · Proof of Witness · shulker y bundle laundering · item frames · entity inventories · hopper laundering · workstation outputs · container transfers · villager trades · chunk-load entity respawn · drop-pickup races · dupes pequeños lavados por storage · copies dentro de contenedores · acquisition-rate abuse (TMAR).

## Documentación adjunta (métodos vanilla)

`Tutorial_Block_and_item_duplication.txt`, `Piston.txt`, `Shelf.txt`, `Copper_Golem.txt`, `Sulfur_Cube.txt` — enciclopedia de dupes vanilla (la mayoría parcheados en Paper).

## Evaluación

- **Reconciliación de inventario** es exactamente lo que propusimos como `tools/reconcile.js` (solo lectura). Confirma que detectar "aumento sin fuente legítima" es la técnica correcta para dupes que no se bloquean en el paquete.
- Nos da la lista canónica de superficies a auditar en el objetivo: **container transfers, drop-pickup races, entity inventories, workstation outputs, item frames, chunk-load respawn** — varios coinciden con los plugins del objetivo (mochilas, subasta, mascotas, crafteo).
- El "acquisition-rate abuse (TMAR)" es el análogo server-side de lo que haríamos al reclamar un kit/reward en ráfaga; nos recuerda espaciar los reclamos para no disparar heurísticas.

**Veredicto:** valida `reconcile.js` como herramienta de detección y aporta la taxonomía de superficies de dupe.
