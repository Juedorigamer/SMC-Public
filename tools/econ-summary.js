// Resumen económico a partir de out/sky-shop-prices.json.
// Solo cálculo local; no contacta al servidor.
// Uso: node tools/econ-summary.js [src] [--out resumen.md]
// Los defaults se resuelven contra la raíz del proyecto (no contra el CWD).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

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
const src = args._[0] ? path.resolve(args._[0]) : path.join(ROOT, 'out', 'sky-shop-prices.json');

let data;
try {
  data = JSON.parse(fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
  console.error(`[!] no pude leer ${src}: ${e.message}`);
  process.exit(2);
}

// Buffer de salida: lo mismo que va a consola puede ir a --out.
const lines = [];
const emit = (s = '') => { lines.push(s); console.log(s); };

const items = [];
for (const c of data.categories || []) {
  for (const it of c.items || []) {
    if (it.buy == null && it.sell == null) continue;
    items.push({ ...it, category: c.name });
  }
}

const fmt = (v) => (v == null ? '-' : v.toLocaleString('es-AR'));

// Tamaño máximo de stack (mismo criterio que reconcile.js): no inflar
// herramientas/armaduras con stacks de 64 inventados; tier-16 usa su tope real.
const MAX1_RE = /(?:^|_)(?:sword|pickaxe|axe|shovel|hoe|elytra|written_book|helmet|chestplate|leggings|boots|totem)(?:$|_)/;
const TIER16 = new Set(['ender_pearl', 'snowball', 'egg', 'sign', 'banner', 'bucket', 'boat', 'minecart', 'armor_stand', 'bed']);
const TIER16_RE = /(?:^|_)(?:sign|banner|bucket|boat|minecart|bed)(?:$|_)/;
function maxStackFor(id) {
  const n = String(id || '');
  if (MAX1_RE.test(n)) return 1;
  if (TIER16.has(n) || TIER16_RE.test(n)) return 16;
  return 64;
}

// 1. Valor por unidad / stack / shulker (27 stacks), solo con precio de venta.
const byId = new Map();
for (const it of items) {
  const prev = byId.get(it.id);
  if (!prev || (it.sell || 0) > (prev.sell || 0)) byId.set(it.id, it);
}
const ranked = [...byId.values()]
  .filter((it) => it.sell != null)
  .map((it) => {
    const max = maxStackFor(it.id);
    return {
      id: it.id,
      name: it.name,
      sell: it.sell,
      maxStack: max,
      stack: max > 1 ? it.sell * max : null,
      shulker: max > 1 ? it.sell * max * 27 : null,
    };
  })
  .sort((a, b) => b.sell - a.sell);

emit('## Top 20 por valor de venta unitario');
emit('| Ítem | Venta/u | Stack (máx.) | Shulker (27 stacks) |');
emit('|---|---:|---:|---:|');
for (const r of ranked.slice(0, 20)) {
  const stackTxt = r.stack == null ? '— (no apila)' : `${fmt(r.stack)} (${r.maxStack})`;
  const shulkerTxt = r.shulker == null ? '—' : fmt(r.shulker);
  emit(`| ${r.id} | ${fmt(r.sell)} | ${stackTxt} | ${shulkerTxt} |`);
}

// 2. Mismo material en varias categorías con precios distintos.
const groups = new Map();
for (const it of items) {
  if (!groups.has(it.id)) groups.set(it.id, []);
  groups.get(it.id).push(it);
}
emit('\n## Mismo material, distintas categorías (compra/venta)');
emit('| Ítem | Categoría | Compra | Venta | Spread |');
emit('|---|---|---:|---:|---:|');
let dupCount = 0;
for (const [id, list] of [...groups.entries()].sort()) {
  if (list.length < 2) continue;
  const sig = new Set(list.map((x) => `${x.buy}/${x.sell}`));
  if (sig.size < 2) continue;
  dupCount++;
  for (const it of list) {
    const spread = it.buy != null && it.sell != null ? it.buy - it.sell : null;
    emit(`| ${id} | ${it.category} | ${fmt(it.buy)} | ${fmt(it.sell)} | ${fmt(spread)} |`);
  }
}
emit(`\nmateriales con precios inconsistentes: ${dupCount}`);

// 3. Spread <= 0 o cero (venta >= compra) y ratios extremos.
// sell === 0 → el ratio no se puede calcular: mostrar '-', no Infinity.
emit('\n## Spread anómalo (venta >= compra o ratio > 50)');
emit('| Ítem | Categoría | Compra | Venta | Ratio |');
emit('|---|---|---:|---:|---:|');
for (const it of items) {
  if (it.buy == null || it.sell == null) continue;
  const ratio = it.sell ? it.buy / it.sell : null;
  if (it.sell >= it.buy || (ratio != null && ratio > 50)) {
    emit(`| ${it.id} | ${it.category} | ${fmt(it.buy)} | ${fmt(it.sell)} | ${ratio == null ? '-' : ratio.toFixed(2)} |`);
  }
}

// 4. Conteo.
emit('\n## Cobertura');
emit(`categorías: ${(data.categories || []).length}; ítems con precio: ${items.length}; materiales únicos: ${byId.size}`);

if (typeof args.out === 'string' && args.out !== 'true' && args.out !== 'false') {
  const outPath = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`\n[ok] ${outPath}`);
} else if (args.out !== undefined) {
  console.error('\n[!] --out necesita una ruta (ej.: --out out/resumen.md); no se escribió nada');
}
