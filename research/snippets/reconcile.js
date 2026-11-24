// reconcile.js — reconciliación de inventario entre dos snapshots (solo lectura).
// Uso: node reconcile.js antes.json despues.json [--out reporte.md]
// Detecta: delta por ítem, aumentos sin fuente legítima (fantasmas) y stacks ilegales.
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).reduce((a, c, i, arr) => {
  if (c.startsWith('--')) { const k = c.slice(2); const n = arr[i + 1]; a[k] = n && !n.startsWith('--') ? n : true; }
  return a;
}, {});

const [beforePath, afterPath] = args._ || process.argv.slice(2).filter((a) => !a.startsWith('--'));
const input = { before: beforePath, after: afterPath };
if (!beforePath || !afterPath) { console.error('uso: node reconcile.js antes.json despues.json'); process.exit(1); }

function snapshot(j) {
  const inv = j.inventoryBefore || j.inventoryAfter || null;
  if (!inv) return null;
  return (inv.slots || []).reduce((m, s) => { m[s.name] = (m[s.name] || 0) + s.count; return m; }, {});
}

const MAX_STACK = {
  bread: 64, stone_sword: 1, compass: 1, written_book: 1, torch: 64, baked_potato: 64,
  spruce_log: 64, chicken: 64, feather: 64,
};

function count(j) {
  const inv = j.inventoryBefore || j.inventoryAfter || null;
  if (!inv || !inv.slots) return null;
  return inv.slots.map((s) => s.count).reduce((a, b) => a + b, 0);
}

const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
const b = snapshot(before) || {};
const a = snapshot(after) || {};

const rows = [];
const names = new Set([...Object.keys(b), ...Object.keys(a)]);
for (const n of [...names].sort()) {
  const d = (a[n] || 0) - (b[n] || 0);
  if (d === 0) continue;
  rows.push({ item: n, before: b[n] || 0, after: a[n] || 0, delta: d, flag: d > 0 ? 'AUMENTO' : 'disminución' });
}

const illegal = [];
for (const [n, c] of Object.entries(a)) {
  const max = MAX_STACK[n] ?? 64;
  if (c > max) illegal.push({ item: n, count: c, max });
}

const out = {
  generatedAt: new Date().toISOString(),
  totalBefore: count(before), totalAfter: count(after),
  deltas: rows,
  suspectedPhantom: rows.filter((r) => r.flag === 'AUMENTO'),
  illegalStacks: illegal,
};
console.log(JSON.stringify(out, null, 2));

if (args.out) fs.writeFileSync(path.resolve(String(args.out)), JSON.stringify(out, null, 2), 'utf8');
