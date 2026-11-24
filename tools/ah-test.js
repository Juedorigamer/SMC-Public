// ah-test.js — pruebas de Auction House (M1 list-leave, M3 NaN/negativo, check).
// Requiere --window-from/--window-until (ISO con offset), cuenta autorizada
// y, para escrituras, --allow-writes. Sin eso no conecta.
'use strict';

const path = require('path');
const {
  parseArgs, die, readSecret, requireWindow, requireWrites, requireAccount,
  sleep, clean, connect, snapshotInventory, findItem, moveToHotbar,
  waitForWindow, saveJson,
} = require('./lib/mc');

const args = parseArgs(process.argv.slice(2));
const MODE = String(args.mode || 'check').toLowerCase();
const MODES = ['check', 'nan', 'negative', 'list-leave'];
if (!MODES.includes(MODE)) die(`--mode inválido (${MODES.join(', ')})`);

const account = requireAccount(args);
const windowScope = requireWindow(args);
if (MODE !== 'check') requireWrites(args, `ah-test --mode ${MODE}`);

const USER = String(args.username || account);
const LOGIN = readSecret(args.login ? String(args.login) : null, args['login-file']);
const PRICE = String(args.price || '1');
const ITEM = String(args.item || 'bread');
const LEAVE_AFTER = Number(args['leave-after'] != null ? args['leave-after'] : 400);
if (!Number.isFinite(LEAVE_AFTER) || LEAVE_AFTER < 0) die('--leave-after debe ser un número >= 0 (ms)');
const OUT = String(args.out || path.join('out', `ah-${MODE}-${Date.now()}.json`));

const result = {
  tool: 'ah-test',
  mode: MODE,
  meta: { generatedAt: new Date().toISOString(), account, window: windowScope, price: PRICE, item: ITEM, leaveAfterMs: LEAVE_AFTER },
  phases: [],
  chat: [],
  events: [],
  windows: [],
  errors: [],
};

function slotText(item) {
  try {
    // clean() quita los §: con lore tipo "§716 §fÍtems" el regex no matcheaba
    // y el criterio M1 ("Tus Subastas >= 1") quedaba indeterminado en silencio.
    return clean(JSON.stringify({ name: item.customName, lore: item.customLore, display: item.displayName }));
  } catch {
    return '';
  }
}

function findSlot(win, re) {
  for (const [slot, item] of Object.entries(win.slots || {})) {
    if (!item) continue;
    if (re.test(slotText(item))) return Number(slot);
  }
  return null;
}

function countFromLore(item) {
  const t = slotText(item);
  // Acepta ambos órdenes: "16 Ítems" e "Ítems: 16".
  const m = t.match(/(\d+)\s*[IÍ]tems?/i) || t.match(/[IÍ]tems?\s*:?\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

async function openAh(bot, chat) {
  const beforeChat = chat.length;
  bot.chat('/ah');
  const win = await waitForWindow(bot, 6000);
  if (!win) return { ok: false, error: 'no abrió /ah' };
  const rec = { at: new Date().toISOString(), type: win.type, slots: [] };
  for (const [slot, item] of Object.entries(win.slots || {})) {
    if (!item) continue;
    rec.slots.push({ slot: Number(slot), id: item.name, text: slotText(item).slice(0, 400) });
  }
  result.windows.push(rec);
  return { ok: true, win, chatBefore: beforeChat };
}

async function ensureItemInHand(bot) {
  const item = findItem(bot, ITEM);
  if (!item) throw new Error(`no hay ${ITEM} en el inventario`);
  // moveToHotbar sin índice busca el primer slot LIBRE de la hotbar: con el
  // slot 0 ocupado, moveSlotItem permutaría el inventario (write colateral).
  const dest = await moveToHotbar(bot, item);
  bot.setQuickBarSlot(dest - 36);
  await sleep(400);
  return item;
}

async function run() {
  // --- check (solo lectura) ---
  if (MODE === 'check') {
    const c = await connect({ username: USER, login: LOGIN, server: args.server || 'towny', direct: args.direct, host: args.host, port: args.port, version: args.version });
    const { bot, chat } = c;
    result.meta.loginVerified = c.loginVerified;
    result.events.push(...c.events);
    const ah = await openAh(bot, chat);
    if (ah.ok) {
      const own = findSlot(ah.win, /Tus Subastas/i);
      const expired = findSlot(ah.win, /Contenedor de Recolecci[oó]n/i);
      result.snapshot = {
        ownAuctions: own != null ? countFromLore(ah.win.slots[own]) : null,
        expired: expired != null ? countFromLore(ah.win.slots[expired]) : null,
      };
      console.log('[check] Tus Subastas:', result.snapshot.ownAuctions, '| Contenedor:', result.snapshot.expired);
    } else {
      result.errors.push(ah.error);
    }
    result.chat = chat.slice(-120);
    await sleep(1500);
    bot.quit();
    saveJson(OUT, result);
    return;
  }

  // --- escrituras ---
  const c = await connect({ username: USER, login: LOGIN, server: args.server || 'towny', direct: args.direct, host: args.host, port: args.port, version: args.version });
  const { bot, chat } = c;
  result.meta.loginVerified = c.loginVerified;
  result.events.push(...c.events);
  result.phases.push({ phase: 'before', inventory: snapshotInventory(bot) });

  await ensureItemInHand(bot);

  if (MODE === 'nan' || MODE === 'negative') {
    const value = MODE === 'nan' ? 'NaN' : String(args.price || '-1');
    const beforeChat = chat.length;
    console.log(`[send] /ah sell ${value}`);
    bot.chat(`/ah sell ${value}`);
    await sleep(2500);
    result.phases.push({
      phase: MODE,
      command: `/ah sell ${value}`,
      chat: chat.slice(beforeChat),
      inventory: snapshotInventory(bot),
    });
    result.chat = chat.slice(-160);
    await sleep(1000);
    bot.quit();
    saveJson(OUT, result);
    return;
  }

  if (MODE === 'list-leave') {
    const beforeChat = chat.length;
    console.log(`[send] /ah sell ${PRICE} (leave en ${LEAVE_AFTER} ms)`);
    bot.chat(`/ah sell ${PRICE}`);
    await sleep(LEAVE_AFTER);
    result.phases.push({
      phase: 'list',
      command: `/ah sell ${PRICE}`,
      chat: chat.slice(beforeChat),
      inventory: snapshotInventory(bot),
    });
    try { bot.quit(); } catch { /* ignore */ }
    await sleep(2500);

    // Reentrar y verificar si el ítem quedó en inventario Y en la subasta.
    const second = await connect({ username: USER, login: LOGIN, server: args.server || 'towny', direct: args.direct, host: args.host, port: args.port, version: args.version });
    result.meta.loginVerifiedSecond = second.loginVerified;
    result.events.push(...second.events.map((e) => ({ session: 'rejoin', ...e })));
    result.phases.push({ phase: 'after-rejoin', inventory: snapshotInventory(second.bot) });
    const ah = await openAh(second.bot, second.chat);
    if (ah.ok) {
      const own = findSlot(ah.win, /Tus Subastas/i);
      result.phases.push({
        phase: 'after-rejoin-ah',
        ownAuctions: own != null ? countFromLore(ah.win.slots[own]) : null,
      });
    } else {
      result.errors.push(ah.error);
    }
    result.chat = [...chat, ...second.chat].slice(-220);
    await sleep(1500);
    second.bot.quit();
    saveJson(OUT, result);
    return;
  }
}

run().catch((e) => {
  console.error('[!] error:', e.message);
  result.errors.push(e.message);
  saveJson(OUT, result);
  process.exit(1);
});
