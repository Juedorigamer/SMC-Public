// Normaliza las ventanas de /shop capturadas por recon.js a un dataset de
// precios compra/venta por categoría. Solo lee JSON; no toca el servidor.
// Uso: node tools/shop-prices.js [src] [--out precios.json]
// Los defaults se resuelven contra la raíz del proyecto (no contra el CWD).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const CAT = {
  20: 'Bloques',
  21: 'Tintes',
  22: 'Comida',
  23: 'Equipamiento',
  24: 'Minerales',
  29: 'Misceláneos',
  30: 'Drops de Mobs',
  31: 'Naturaleza',
  32: 'Lafquen (Mar)',
  33: 'Redstone',
};

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
const src = args._[0] ? path.resolve(args._[0]) : path.join(ROOT, 'out', 'sky-shop-cats.json');
// --out sin valor (booleano true o el string "true" de un flag) cae al default,
// nunca crea un archivo basura llamado "true".
const outFlagBad = args.out === true || args.out === 'true' || args.out === 'false';
const outPath =
  typeof args.out === 'string' && !outFlagBad
    ? path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out)
    : args._[1]
      ? path.resolve(args._[1])
      : path.join(ROOT, 'out', 'sky-shop-prices.json');
if (outFlagBad) console.error('[!] --out sin valor: se usa el destino por defecto');

// Gramática de dinero:
//  - sufijo k/m → multiplicador (2.5k, 1,5m).
//  - UN separador con parte entera de ≤3 dígitos y 1-2 decimales (y que no sea
//    el patrón de miles xxx.000) → decimal ($1.5 = 1,5; $0.75 = 0,75).
//  - cualquier otro caso → separadores de miles (1.500, 20.500, 1,500,000…),
//    con grupos válidos de 3 dígitos.
//  - lo que no encaja en esa gramática devuelve null (se cuenta en
//    unparsedPriceLines en vez de corromper el dataset en silencio).
function parseMoney(raw) {
  const s = String(raw).trim().replace(/\s+/g, '');
  if (!s) return null;
  const suffix = /([kKmM])$/.exec(s);
  if (suffix) {
    const body = s.slice(0, -1).replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(body)) return null;
    const n = Number(body);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * (/k/i.test(suffix[1]) ? 1e3 : 1e6));
  }
  const seps = s.match(/[.,]/g) || [];
  if (!seps.length) {
    return /^\d+$/.test(s) ? Number(s) : null;
  }
  if (seps.length === 1) {
    const sep = seps[0];
    const i = s.indexOf(sep);
    const intPart = s.slice(0, i);
    const decPart = s.slice(i + 1);
    // decimal: entero corto + 1-2 decimales (el patrón de miles xxx.000 tiene
    // 3 dígitos tras el punto y queda cubierto por la rama de miles)
    if (/^\d{1,3}$/.test(intPart) && /^\d{1,2}$/.test(decPart)) {
      return Number(`${intPart}.${decPart}`);
    }
    // si no: separador de miles — exige grupos de 3
    if (/^\d{1,3}[.,]\d{3}$/.test(s)) return Number(s.replace(/[.,]/g, ''));
    return null;
  }
  // más de un separador: solo miles válido
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  return null;
}

const unparsed = [];
function field(lore, re) {
  for (const line of lore || []) {
    const m = line.match(re);
    if (!m) continue;
    const v = parseMoney(m[1]);
    if (v == null) {
      unparsed.push(String(line).trim());
      continue;
    }
    return v;
  }
  return null;
}

function parseItem(s) {
  const lore = s.lore || [];
  return {
    slot: s.slot,
    id: s.id,
    count: s.count,
    name: s.name,
    buy: field(lore, /compra:\s*\$?\s*([\d.,]+[kKmM]?)/i),
    sell: field(lore, /venta:\s*\$?\s*([\d.,]+[kKmM]?)/i),
    lore: lore.slice(0, 8),
  };
}

let j;
try {
  j = JSON.parse(fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
  console.error(`[!] no pude leer ${src}: ${e.message}`);
  process.exit(2);
}
const windows = j.windows || [];

// Emparejamiento padre/hijo: la ventana cliqueada (clickedSlot) abre la
// categoría siguiente. Se busca la próxima ventana con el mismo `cmd`
// (disponible en las capturas de recon) en vez de tomar windows[i+1] a ciegas;
// si el clic no abrió nada, la categoría degrada a vacía y se cuenta.
let missingChild = 0;
const categories = [];
for (let i = 0; i < windows.length; i++) {
  const w = windows[i];
  if (w.clickedSlot == null) continue;
  const name = CAT[w.clickedSlot] || `slot-${w.clickedSlot}`;
  let child = null;
  if (w.cmd != null && String(w.cmd) !== '') {
    for (let k = i + 1; k < windows.length; k++) {
      const c = windows[k];
      // otra sesión de GUI (cmd distinto): el clic no abrió nada
      if (c && c.cmd != null && String(c.cmd) !== String(w.cmd)) break;
      child = c;
      break;
    }
  } else {
    child = windows[i + 1] || null;
  }
  if (!child || !Array.isArray(child.slots)) {
    missingChild++;
    categories.push({ name, slot: w.clickedSlot, windowTitle: '', items: [], missingChild: true });
    continue;
  }
  const items = child.slots.map(parseItem);
  categories.push({ name, slot: w.clickedSlot, windowTitle: child.title || '', items });
}

const priced = categories.flatMap((c) => c.items.filter((it) => it.buy != null || it.sell != null));
const unpriced = categories.flatMap((c) =>
  c.items.filter((it) => it.buy == null && it.sell == null && it.name !== it.id)
);

console.log(`origen: ${src}`);
console.log(`categorías: ${categories.length}`);
for (const c of categories) {
  const p = c.items.filter((it) => it.buy != null || it.sell != null);
  console.log(`\n## ${c.name} (slot ${c.slot}) — ${c.items.length} ítems, ${p.length} con precio${c.missingChild ? ' [ventana hija no encontrada]' : ''}`);
  for (const it of p) {
    const ratio = it.buy != null && it.sell ? (it.buy / it.sell).toFixed(2) : '-';
    console.log(
      `  [${String(it.slot).padStart(2)}] ${String(it.id).padEnd(24)} ` +
        `buy=${String(it.buy).padStart(8)} sell=${String(it.sell).padStart(8)} ratio=${ratio}`
    );
  }
  const special = c.items.filter((it) => it.buy == null && it.sell == null && it.name !== it.id);
  for (const it of special) {
    console.log(`  [${String(it.slot).padStart(2)}] ${String(it.id).padEnd(24)} (sin precio) ${it.name}`);
    for (const l of (it.lore || []).slice(0, 2)) console.log(`         · ${l}`);
  }
}

console.log(`\ncon precio: ${priced.length}; sin precio con nombre: ${unpriced.length}`);
const suspect = priced.filter((it) => it.buy != null && it.sell != null && it.sell >= it.buy);
console.log(`anomalías venta >= compra: ${suspect.length}`);
for (const it of suspect) console.log(`  !! ${it.id} buy=${it.buy} sell=${it.sell}`);
const unparsedUnique = [...new Set(unparsed)];
console.log(`líneas de precio no parseables: ${unparsed.length}${unparsedUnique.length ? ' (ej.: ' + unparsedUnique.slice(0, 3).map((l) => JSON.stringify(l)).join(' | ') + ')' : ''}`);
if (missingChild) console.log(`categorías sin ventana hija: ${missingChild}`);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: path.resolve(src),
      categories,
      unparsedPriceLines: unparsed.length,
      unparsedPriceExamples: unparsedUnique.slice(0, 20),
      categoriesWithoutChild: missingChild,
    },
    null,
    2
  )
);
console.log(`\nJSON: ${outPath}`);
