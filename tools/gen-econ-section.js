// Genera la sección 9 del informe de Skyblock a partir de out/sky-shop-prices.json.
// Solo cálculo local: no contacta al servidor ni modifica nada.
// Uso: node tools/gen-econ-section.js [src] [--out seccion.md]
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
// --out sin valor (booleano true o el string "true" de un flag) cae al default,
// nunca crea un archivo basura llamado "true".
const outFlagBad = args.out === true || args.out === 'true' || args.out === 'false';
const outPath =
  typeof args.out === 'string' && !outFlagBad
    ? path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out)
    : args._[1]
      ? path.resolve(args._[1])
      : path.join(ROOT, 'out', 'skyblock-seccion9.md');
if (outFlagBad) console.error('[!] --out sin valor: se usa el destino por defecto');

let data;
try {
  data = JSON.parse(fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
  console.error(`[!] no pude leer ${src}: ${e.message}`);
  process.exit(2);
}

const n = (v) => (v == null ? '-' : Number(v).toLocaleString('es-AR'));
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1).replace('.', ',')} %` : '-');
const ratio = (buy, sell) => (buy != null && sell ? (buy / sell).toFixed(2).replace('.', ',') : '-');
const dec = (v) => (v == null ? '-' : v.toFixed(2).replace('.', ','));

// Mediana única para todo el informe (antes había una superior y una inferior
// en el mismo documento). Par: promedio de los dos centros; impar: el centro.
function median(arr) {
  if (!arr || !arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const items = [];
for (const c of data.categories || []) {
  for (const it of c.items || []) {
    if (it.buy == null && it.sell == null) continue;
    items.push({ ...it, category: c.name });
  }
}

// Índice por material: se conserva el precio de venta máximo para valorar.
const byId = new Map();
for (const it of items) {
  const prev = byId.get(it.id);
  if (!prev) byId.set(it.id, it);
  else {
    if ((it.sell || 0) > (prev.sell || 0)) byId.set(it.id, { ...prev, ...it });
  }
}

// 1. Cobertura por categoría.
const catRows = (data.categories || []).map((c) => {
  const priced = (c.items || []).filter((it) => it.buy != null || it.sell != null);
  const ratios = priced
    .filter((it) => it.buy != null && it.sell)
    .map((it) => it.buy / it.sell);
  const med = median(ratios);
  return { name: c.name, slot: c.slot, total: (c.items || []).length, priced: priced.length, med };
});

// 2. Top por valor de venta unitario.
const top = [...byId.values()]
  .filter((it) => it.sell != null)
  .sort((a, b) => b.sell - a.sell)
  .slice(0, 20);

// 3. Arbitraje entre categorías (comprar en A y vender en B).
const arb = [];
for (const a of items) {
  if (a.buy == null) continue;
  for (const b of items) {
    if (b.sell == null || a.id !== b.id) continue;
    if (b.sell > a.buy) {
      arb.push({ id: a.id, buy: a.buy, buyCat: a.category, sell: b.sell, sellCat: b.category, profit: b.sell - a.buy });
    }
  }
}
arb.sort((x, y) => y.profit - x.profit);

// 4. Materiales con precios distintos según categoría.
const groups = new Map();
for (const it of items) {
  if (!groups.has(it.id)) groups.set(it.id, []);
  groups.get(it.id).push(it);
}
const fragmented = [...groups.entries()]
  .filter(([, list]) => new Set(list.map((x) => `${x.buy}/${x.sell}`)).size > 1)
  .sort((a, b) => a[0].localeCompare(b[0]));

// 5. Spreads anómalos.
const anomalies = items
  .filter((it) => it.buy != null && it.sell != null)
  .filter((it) => it.sell >= it.buy || it.buy / it.sell > 50)
  .sort((a, b) => b.buy / b.sell - a.buy / a.sell);

// Filtros de stone: sin datos no hay min/max (Math.min/max de array vacío
// fabricaba ±∞ presentados como hallazgo). stoneOk decide si E-01 aplica.
const stoneBuys = items.filter((x) => x.id === 'stone' && x.buy != null).map((x) => x.buy);
const stoneSells = items.filter((x) => x.id === 'stone' && x.sell != null).map((x) => x.sell);
const stoneBuy = stoneBuys.length ? Math.min(...stoneBuys) : null;
const stoneSell = stoneSells.length ? Math.max(...stoneSells) : null;
const stoneOk = stoneBuy != null && stoneSell != null;
const stoneProfit = stoneOk ? stoneSell - stoneBuy : null;
const invProfit = stoneProfit != null ? stoneProfit * 36 * 64 : null;

const ratios = items.filter((it) => it.buy != null && it.sell).map((it) => it.buy / it.sell);
const medianRatio = median(ratios);
const tight = items
  .filter((it) => it.buy != null && it.sell)
  .filter((it) => it.buy / it.sell <= 2)
  .sort((a, b) => a.buy / a.sell - b.buy / b.sell);

const nbBuy = byId.get('nether_bricks') ? byId.get('nether_bricks').buy : null;
const rnbSell = byId.get('red_nether_bricks') ? byId.get('red_nether_bricks').sell : null;
const craftProfit = nbBuy != null && rnbSell != null ? rnbSell * 2 - nbBuy * 2 : null;

const L = [];
const p = (s = '') => L.push(s);

p('## 9. Mapa económico de Skyblock (solo lectura)');
p();
p('**Fuente:** `out/sky-shop-prices.json` — 10 categorías de `/shop`, capturadas en una sola conexión con `--click-slots`.');
p('**Método:** navegación de GUI sin comprar ni vender (solo clic de apertura de categoría). Ningún ítem se movió, compró, vendió ni reclamó.');
p();
p('### 9.1 Cobertura');
p();
p('| Categoría | Slot | Ítems en la GUI | Con precio | Ratio mediana compra/venta |');
p('|---|---:|---:|---:|---:|');
for (const c of catRows) {
  p(`| ${c.name} | ${c.slot} | ${c.total} | ${c.priced} | ${c.med ? dec(c.med) : '-'} |`);
}
p();
const medTxt =
  medianRatio == null
    ? '**-** (no hay ítems con compra y venta en el dataset)'
    : `**${dec(medianRatio)}x** (comprar cuesta unas ${Math.round(medianRatio)} veces lo que paga la venta)`;
p(`Total: **${items.length} precios** sobre **${byId.size} materiales únicos**. La mediana global del spread es ${medTxt}, calculada sobre ${ratios.length} ítems con compra y venta.`);
p();
p('### 9.2 Valor por unidad, stack y shulker');
p();
p('| Ítem | Venta/u | Stack (64) | Shulker (27 stacks) |');
p('|---|---:|---:|---:|');
for (const it of top) {
  p(`| \`${it.id}\` | ${n(it.sell)} | ${n(it.sell * 64)} | ${n(it.sell * 64 * 27)} |`);
}
p();
p('El orden lo determina el precio de venta, es decir, cuánto dinero entrega el servidor por el ítem. No implica que el ítem sea obtenible a ese costo.');
p();
p('### 9.3 Hallazgos deterministas');
p();
p('> Todos surgen de precios publicados en `/shop`. Ninguno requiere haber ejecutado una transacción.');
p();
if (stoneOk) {
  p(`**E-01 · Arbitraje directo de \`stone\`.** En **Bloques** se compra a **${n(stoneBuy)}**; en **Drops de Mobs** y **Lafquen (Mar)** se vende a **${n(stoneSell)}**. Beneficio: **+${n(stoneProfit)} por unidad**; la venta devuelve el doble del costo (margen +100 %). Un inventario de 36 stacks (2.304 unidades) rinde **+${n(invProfit)}**. Es el único par compra/venta con beneficio positivo en las 10 categorías.`);
} else {
  p('**E-01 · Arbitraje directo de `stone`.** _Omitido: el dataset no tiene precios de compra/venta de `stone` (filtro vacío), así que no hay hallazgo que reportar._');
}
p();
if (craftProfit != null) {
  p(`**E-02 · Cadena de craft \`nether_bricks\` → \`red_nether_bricks\`.** Los \`nether_bricks\` se compran a **${n(nbBuy)}**; 2 ladrillos (${n(nbBuy * 2)}) más verruga del Nether producen 2 \`red_nether_bricks\` que se venden a **${n(rnbSell)}** cada uno (${n(rnbSell * 2)}): **+${n(craftProfit)} por craft** (+${pct(craftProfit, nbBuy * 2)} sobre el costo de los ladrillos). La verruga no está en el shop: el margen depende de producirla en granja.`);
  p();
}
p('**E-03 · Spread cero en dos ítems.** `netherrack` se compra y se vende a **35**; `red_nether_bricks`, a **75/75**. Comprar y vender no genera ni pierde dinero. No es un duplicado, pero el shop funciona como conversor sin pérdida y borra la trazabilidad del origen: cualquier ítem obtenido por otra vía se puede "blanquear" a precio fijo. _Cifras congeladas de la corrida del 2026-10-26 — regenerar antes de reutilizar._');
p();
p('**E-04 · Valuación inconsistente de comida.** `baked_potato` se compra a **512** y se vende a **4** (ratio 128); `pumpkin_pie` se compra a **512** y se vende a **256** (ratio 2). Dos ítems con el mismo precio de compra tienen un valor de venta 64 veces distinto. Una `pumpkin_pie` paga **256**, 85 veces la venta de `sweet_berries` (**3**) y 64 veces la de `baked_potato` (**4**). No hay `pumpkin` en el shop: el precio alto premia una granja, no una compra. _Cifras congeladas de la corrida del 2026-10-26 — regenerar antes de reutilizar._');
p();
p(`**E-05 · Concentración de valor en \`shulker_shell\`.** Se compra a **20.500** y se vende a **15.050**: la venta paga el **${pct(15050, 20500)}** de la compra (ratio 1,36 frente a la mediana ${dec(medianRatio)}). Un shulker lleno de shells (1.728 unidades) vale **26.006.400**, el segundo mayor valor por contenedor del dataset, solo detrás de \`netherite_block\` (31.104.000). Es el ítem que más justifica auditar \`AxShulkers\`. _Cifras congeladas de la corrida del 2026-10-26 — regenerar antes de reutilizar._`);
p();
const stoneFragment = stoneOk
  ? ` El caso extremo es \`stone\` (${n(stoneBuy)} de compra en Bloques frente a ${n(stoneSell)} de venta en Drops/Lafquen, ya explotado en E-01).`
  : '';
p(`**E-06 · Fragmentación de precios entre categorías.** **${fragmented.length} materiales** aparecen con precios distintos según la categoría.${stoneFragment} Le siguen \`sweet_berries\` (compra 10 en Comida vs. 90 en Naturaleza, 9x), \`dark_prismarine\` (90 vs. 300, 3,3x) y \`prismarine_shard\` (60 vs. 180, 3x). El shop no usa una tabla global de precios: cada categoría define la suya.`);
p();
p('**E-07 · Superficie de venta masiva sin fricción visible.** `/shop` documenta "Clic central (o soltar) para vender todo" y existe `zshop-sell-all`; el precio se resuelve por material, no por NBT. Consecuencia: **cualquier duplicación de ítems se monetiza en un solo clic**, y cualquier desincronización de inventario se convierte directamente en saldo. No es un fallo por sí mismo; es el multiplicador de impacto de D-01…D-11.');
p();
p('### 9.4 Precios del mismo material en distintas categorías');
p();
p('| Ítem | Categoría | Compra | Venta | Spread |');
p('|---|---|---:|---:|---:|');
for (const [id, list] of fragmented) {
  for (const it of list) {
    const spread = it.buy != null && it.sell != null ? it.buy - it.sell : null;
    p(`| \`${id}\` | ${it.category} | ${n(it.buy)} | ${n(it.sell)} | ${n(spread)} |`);
  }
}
p();
p('### 9.5 Spreads anómalos (venta ≥ compra o ratio > 50)');
p();
p('| Ítem | Categoría | Compra | Venta | Ratio |');
p('|---|---|---:|---:|---:|');
for (const it of anomalies) {
  p(`| \`${it.id}\` | ${it.category} | ${n(it.buy)} | ${n(it.sell)} | ${ratio(it.buy, it.sell)} |`);
}
p();
p(`Solo **${tight.length} ítems** tienen un ratio ≤ 2 (venta a la mitad o más del precio de compra): ${tight.map((it) => `\`${it.id}\` (${it.buy}/${it.sell})`).join(', ')}. Son los candidatos naturales a conversión de valor: se compran y se venden dentro del shop con una pérdida pequeña, no con ganancia.`);
p();
if (stoneOk) {
  p('Ninguno de los ítems de la tabla de anomalías permite arbitraje por sí mismo: el único par con beneficio positivo es `stone` (E-01), que no aparece aquí porque su ratio dentro de Bloques es 5,00. Los ratios altos son el comportamiento esperado del shop (compra cara, venta barata); los ratios 1,00 son la anomalía de configuración.');
} else {
  p('Ninguno de los ítems de la tabla de anomalías permite arbitraje por sí mismo. Los ratios altos son el comportamiento esperado del shop (compra cara, venta barata); los ratios 1,00 son la anomalía de configuración.');
}
p();
p('### 9.6 Hipótesis de duplicación (no verificadas)');
p();
p('> Ordenadas por impacto esperado × factibilidad con la cuenta actual. **Ninguna fue probada.** La cuenta de prueba no tiene isla, llaves ni objetos en subasta, así que varias requieren preparación previa o una cuenta con progreso.');
p();
p('| ID | Hipótesis | Vector | Impacto | Prerrequisito | Factibilidad | Estado |');
p('|---|---|---|---|---|---|---|');
p('| **D-01** | `AxShulkers` no conserva bien el contenido al convertir/limpiar un shulker | `/axshulker clear` sobre un shulker con contenido; mover ítems y ejecutar durante el desync | **Alto** (27 stacks por shulker; E-05) | 1 shulker + contenido | Media | No verificado |');
p('| **D-02** | `RoseStacker` duplica al separar stacks de ítems o entidades | Romper un stack, descargar chunk, o usar el GUI de separación | Alto | Acceso a granja con stacks | Media-baja | No verificado |');
p('| **D-03** | `CustomCrafting` devuelve contenedor + resultado | Receta custom con balde/botella/shulker como ingrediente y remainder | Medio | Conocer la receta exacta (enumeración incompleta) | Media | No verificado |');
p('| **D-04** | `zAuctionHouse`: carrera entre compra y cancelación/caducidad | Listar, comprar con segunda cuenta y cancelar en la misma ventana | **Alto** | Segunda cuenta exenta o coordinación con el cliente | Baja | No verificado |');
p('| **D-05** | `zshop-sell-all` acredita dos veces bajo lag o reloj | Repetir la venta mientras el inventario no se sincronizó; relog inmediato | Medio-alto | Ítems vendibles | Media | No verificado |');
p('| **D-06** | `AxMinions` entrega producción dos veces | Reclamar, cerrar antes del ack, reabrir; minion `Chest` que autovende | **Alto** (ingreso pasivo → dinero) | Isla con minions | Media | No verificado |');
p('| **D-07** | `/stash` "Reclamar Todo" con inventario lleno | Reclamar, dejar ítems en el suelo, reclamar de nuevo | Medio | Ítems en stash | Media | No verificado |');
p('| **D-08** | `/disposal` o `/bin` procesa borrado y devolución a la vez | Poner un ítem basura y cerrar la GUI antes del ack | Bajo-medio | 1 ítem basura | Media | No verificado |');
p('| **D-09** | `IridiumSkyblock` banco/upgrade acepta montos negativos o reembolsa doble | `/is bank deposit` con valor negativo; cancelar upgrade | **Alto** | Isla propia | Baja-media | No verificado |');
p('| **D-10** | `EcoCrates` otorga recompensa antes de consumir la llave | Abrir caja y relog entre recompensa y descuento | Medio | Llave de caja | Baja | No verificado |');
p('| **D-11** | `ItemEdit`/`NBTAPI` permite stack size > 1 en ítems no apilables | Crear pila de shulkers/elytras y separar | **Alto** | Permiso de edición de ítems | Baja | No verificado |');
p();
p('Criterio de priorización: D-01 y D-06 combinan impacto alto con un prerrequisito alcanzable; D-05 y D-03 son las siguientes por facilidad; D-04, D-09, D-10 y D-11 dependen de permisos, isla o una segunda cuenta que hoy no están disponibles.');
p();
p('### 9.7 Primeras pruebas propuestas (pendientes de aprobación)');
p();
if (stoneOk) {
  p('**T-01 · Arbitraje de `stone` (una unidad).**');
  p();
  p('1. Snapshot: saldo (`/money`), inventario y contenedores. Guardar JSON y hora.');
  p(`2. \`/shop\` → **Bloques** (slot 20) → comprar **1 stone** (slot **0**, clic izquierdo). Esperado: saldo −${n(stoneBuy)}, +1 stone.`);
  p(`3. \`/shop\` → **Drops de Mobs** (slot 30) → vender **1 stone** (slot **27**, clic derecho). Esperado: saldo +${n(stoneSell)}, −1 stone.`);
  p(`4. Resultado esperado: **+${n(stoneProfit)} neto**, sin ítems.`);
  p('5. Relog y repetir una vez con otra unidad. Si el segundo ciclo no reproduce el mismo delta, se detiene y se reporta como no reproducible.');
  p();
  p('**Aborto:** si el saldo no cambia exactamente lo previsto, si el ítem no aparece o desaparece de más, si el precio mostrado difiere del dataset, o si la latencia supera 2.500 ms tres veces. **Exposición máxima:** 20 Dineros. **Rollback:** el administrador descuenta los 20 Dineros acreditados (`/eco take`); no quedan ítems.');
  p();
} else {
  p('**T-01 · Arbitraje de `stone` (una unidad).** _No aplica: el dataset actual no tiene precios de compra y venta de `stone` sobre los que armar la prueba._');
  p();
}
p('**T-02 · Cancelación de subasta (1 dirt).**');
p();
p('1. Snapshot: saldo + inventario. Comprar 1 `dirt` en **Bloques** (250) si la cuenta no lo tiene.');
p('2. `/ah sell 999999 1` con el dirt (precio alto para que no se venda). Anotar comisión si el plugin la cobra.');
p('3. Verificar que el dirt desaparece del inventario y aparece en "TUS OBJETOS".');
p('4. Cancelar la subasta y verificar que vuelve **exactamente 1 dirt** y que el saldo solo cambió por la comisión.');
p('5. Relog y confirmar que no hay una segunda copia ni en inventario ni en "OBJETOS CADUCADOS".');
p();
p('**Aborto:** si el ítem se duplica, si la cancelación no devuelve nada, o si la comisión no está documentada y supera 250. **Exposición máxima:** 1 dirt + comisión. **Rollback:** la propia cancelación; si el ítem se pierde, `AxInventoryRestore` del administrador.');
p();
p('Ninguna de las dos pruebas se ejecutó. La herramienta ya distingue clic de navegación de clic transaccional: `--click-kind trade` exige `--allow-writes` y aborta con exit 4 antes de conectar si falta. `/ah sell` sigue bloqueado por el guard y requiere una allowlist acotada, no `--allow-writes` global.');
p();
p('### 9.8 Límites de esta sección');
p();
p('- El mapa cubre **precios publicados**, no ventas reales: no dice si el shop acepta el ítem (por NBT, durabilidad o encantamientos).');
p('- La cuenta de prueba **no tiene isla**: D-06 y D-09 requieren una isla propia (o autorización para crearla). D-07 solo requiere ítems en el stash.');
p('- No hay llaves ni objetos en subasta: D-04 y D-10 no son observables con esta cuenta.');
p('- La enumeración de recetas custom quedó incompleta: `zMenu` persiste la última página y volver a la lista requiere clic derecho en el slot 49; `--click-button right` ya existe, pero el recorrido completo no se validó.');
p('- Los ratios asumen que el precio se paga por unidad; los ítems con `count > 1` en la GUI (herramientas, armaduras) no se normalizaron por stack.');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, L.join('\n') + '\n', 'utf8');
console.log(`sección escrita: ${outPath} (${L.length} líneas)`);
