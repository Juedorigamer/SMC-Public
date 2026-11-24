// reconcile.js — reconciliación de inventario entre dos snapshots (solo lectura).
// Uso: node tools/reconcile.js antes.json despues.json [--out reporte.json]
// Acepta: recon JSON (inventoryAfter/inventoryBefore), tool JSON (phases[].inventory)
// o un snapshot plano { slots:[{name,count}] }.
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const n = argv[i + 1]; out[k] = n && !n.startsWith('--') ? n : true; }
    else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const [beforePath, afterPath] = args._;
if (!beforePath || !afterPath) {
  console.error('uso: node tools/reconcile.js antes.json despues.json [--out reporte.json]');
  process.exit(1);
}

// Máximo de apilado por ítem (vanilla). Herramientas/armaduras no apilan: la
// regex usa límites de palabra reales ((?:^|_)pieza(?:$|_)) para que
// `waxed_copper_block` NO matchee "axe" como subcadena. Tier-16: perlas,
// huevos, carteles, banners, baldes, botes, vagonetas, armor stands y camas
// (con variantes: oak_sign, red_bed, chest_minecart, water_bucket…).
// `compass` apila a 64 en vanilla, así que NO va a la lista de max 1.
const MAX_STACK_DEFAULT = 64;
const MAX1_RE = /(?:^|_)(?:sword|pickaxe|axe|shovel|hoe|elytra|written_book|helmet|chestplate|leggings|boots|totem)(?:$|_)/;
const TIER16 = new Set([
  'ender_pearl', 'snowball', 'egg', 'sign', 'banner', 'bucket', 'boat', 'minecart',
  'armor_stand', 'bed',
]);
const TIER16_RE = /(?:^|_)(?:sign|banner|bucket|boat|minecart|bed)(?:$|_)/;

function maxFor(name) {
  const n = String(name || '');
  if (MAX1_RE.test(n)) return 1;
  if (TIER16.has(n) || TIER16_RE.test(n)) return 16;
  return MAX_STACK_DEFAULT;
}

function extractSlots(j, side) {
  if (!j) return null;
  // snapshot plano
  if (Array.isArray(j.slots)) return j.slots;
  // recon JSON: el lado pedido decide qué inventario usar (antes nunca debe
  // devolver el inventario "after" de un JSON de recon).
  const inv = side === 'before' ? j.inventoryBefore : j.inventoryAfter;
  if (inv && Array.isArray(inv.slots)) return inv.slots;
  // tools con phases: fase por etiqueta antes de caer a extremos
  if (Array.isArray(j.phases)) {
    const label = (p) => String((p && (p.phase != null ? p.phase : p.name)) || '');
    const match =
      side === 'before'
        ? (l) => l === 'before' || /-before$/.test(l)
        : (l) => l === 'after' || l === 'backend-after' || /-after$/.test(l);
    for (const p of j.phases) {
      if (p && p.inventory && Array.isArray(p.inventory.slots) && match(label(p))) return p.inventory.slots;
    }
    // fallback: primera (before) / última (after) fase con inventario
    const withInv = j.phases.filter((p) => p && p.inventory && Array.isArray(p.inventory.slots));
    if (withInv.length) {
      return side === 'before' ? withInv[0].inventory.slots : withInv[withInv.length - 1].inventory.slots;
    }
  }
  return null;
}

function totals(slots) {
  const m = {};
  for (const s of slots || []) {
    if (!s || !s.name) continue;
    m[s.name] = (m[s.name] || 0) + (Number(s.count) || 0);
  }
  return m;
}

const beforePathResolved = path.resolve(beforePath);
const afterPathResolved = path.resolve(afterPath);
// mismo archivo (Windows compara rutas case-insensitive)
const samePath =
  beforePathResolved === afterPathResolved ||
  beforePathResolved.toLowerCase() === afterPathResolved.toLowerCase();

const before = JSON.parse(fs.readFileSync(beforePathResolved, 'utf8').replace(/^\uFEFF/, ''));
const after = samePath ? before : JSON.parse(fs.readFileSync(afterPathResolved, 'utf8').replace(/^\uFEFF/, ''));

const bs = extractSlots(before, 'before');
const as = extractSlots(after, 'after');
if (!bs || !as) {
  console.error('[!] no encontré inventario en uno de los archivos');
  process.exit(2);
}

// Mismo archivo con ambos inventarios: se usan como antes/después reales
// (antes devolvía "sin cambios" por leer dos veces el inventario post).
const sameFileBothSides =
  samePath &&
  before.inventoryBefore && Array.isArray(before.inventoryBefore.slots) &&
  before.inventoryAfter && Array.isArray(before.inventoryAfter.slots);

const bt = totals(bs);
const at = totals(as);
const names = new Set([...Object.keys(bt), ...Object.keys(at)]);
const deltas = [];
for (const n of [...names].sort()) {
  const d = (at[n] || 0) - (bt[n] || 0);
  if (d !== 0) deltas.push({ item: n, before: bt[n] || 0, after: at[n] || 0, delta: d, flag: d > 0 ? 'AUMENTO' : 'disminucion' });
}

// Validación POR SLOT: los totals suman stacks legales (dirt 64+64 = 128 en
// dos slots es perfectamente válido); el tope de `maxFor` es por stack.
const illegal = [];
for (const s of as) {
  if (!s || !s.name) continue;
  const count = Number(s.count) || 0;
  const max = maxFor(s.name);
  if (count > max) illegal.push({ slot: s.slot == null ? null : s.slot, item: s.name, count, max });
}

const out = {
  generatedAt: new Date().toISOString(),
  before: path.basename(beforePath),
  after: path.basename(afterPath),
  totalsBefore: bt,
  totalsAfter: at,
  deltas,
  suspectedPhantom: deltas.filter((d) => d.flag === 'AUMENTO'),
  illegalStacks: illegal,
};
if (sameFileBothSides) out.sameFileBothSides = true;

console.log(JSON.stringify(out, null, 2));
// --out sin valor (booleano true o el string "true" de un flag) no debe
// crear un archivo basura llamado "true": validar antes de escribir.
if (typeof args.out === 'string' && args.out !== 'true' && args.out !== 'false') {
  const outResolved = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outResolved), { recursive: true });
  fs.writeFileSync(outResolved, JSON.stringify(out, null, 2), 'utf8');
  console.log(`[ok] ${args.out}`);
} else if (args.out !== undefined) {
  console.error('[!] --out necesita una ruta de archivo (ej.: --out reporte.json); no se escribió nada');
}
