# Skill — Reconciliación de inventario y detección de dupes

**Método:** M8 (y detección transversal) · **Herramienta:** `research/snippets/reconcile.js`

## Causa raíz / detección

Un dupe deja un **aumento de ítems sin fuente legítima**. La reconciliación compara dos snapshots y marca:
- delta por ítem (before/after),
- aumentos sin origen válido (fantasmas),
- stacks ilegales (count > maxStack),
- ítems dentro de shulkers/bundles over-stacked.

## Señales en el objetivo

- Container transfers (subasta, mochila, mascota, enderchest).
- Drop-pickup races.
- Entity inventories, item frames, workstation outputs.

## Uso

```
node research/snippets/reconcile.js antes.json despues.json [--out reporte.md]
```

## Referencia

- `BetterAntiDupe` "Chain of Custody ledger" (balance reconciliation, proof of witness, laundering).
- `DupeWatch` "illegal over-stacked items", "physical dupe verification".

## Límites

- Solo lectura; no conecta; no modifica.
- Requiere dos JSON de `recon.js` con `--click-kind trade` (snapshot before/after).
