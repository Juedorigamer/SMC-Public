# Skill — Abuso de campos numéricos (overflow / NaN / negativo / rounding)

**Métodos:** M3, M10 · **Herramienta:** `--extra-probe` + `packet-race.js`

## Causa raíz

Parseo de número sin validar signo, magnitud o representación. El resultado se usa en economía (precio, monto, comisión) o en conteo de ítems.

## Señales en el objetivo

- `/ah sell <precioComprarAhora> [inicial] [incremento]` (arbitrario).
- `/cf create [moneda] <cantidad>`.
- QuickShop `/chestshop price/amount/currency`.
- Lotería (10% impuesto), comisión de subasta.

## Pruebas (una por corrida)

| Entrada | Qué busca |
|---|---|
| `NaN` | Listado/ítem inválido o no comprable. |
| `-1` | Flujo de dinero invertido. |
| `1e11` / `999999999999` | Integer overflow (patrón `11e11`). |
| `0` | Gratis / gratis inverso. |
| montos pequeños (1, 3, 7) | Rounding a favor del jugador en reembolso/impuesto. |

## Verificación

- Snapshot de saldo antes/después; relog; reproducir.
- `reconcile.js` para detectar deltas de dinero/ítems.

## Límites

- No encadenar; una hipótesis por corrida.
- Monto mínimo; rollback del supervisor.

## Referencia

- AuctionHouse `NaN` (Spigot reviews), Fadah `11e11`, `Lost-Auction` (CVE-2026-55624).
