// cf-test.js — prueba controlada de la hipótesis de reembolso doble en UltraCoinFlip.
//
// Solo para la ventana autorizada. Crea un coinflip PRIVADO por el monto mínimo
// (100$ por defecto), envía /cf delete dos veces con un delay configurable y
// compara el saldo. No interactúa con otros jugadores: el juego se crea privado
// y el modo se VERIFICA como privado antes de crear (un "unknown" aborta).
//
// Guardas (2026-11-23): exige --window-from/--window-until vigentes con zona
// horaria, cuenta autorizada (tools/lib/mc.js) y --allow-writes. Sin eso no
// conecta.
//
// Uso:
//   node tools/cf-test.js --login-file .secrets/auditor.txt \
//     --window-from <ISO-con-offset> --window-until <ISO-con-offset> \
//     --allow-writes --amount 100 --delay 100 --out out/cf-test-01.json

'use strict';

const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const {
  parseArgs, die, readSecret, requireAccount, requireWindow, requireWrites,
} = require('./lib/mc');

const args = parseArgs(process.argv.slice(2));
const account = requireAccount(args);
const windowScope = requireWindow(args);
requireWrites(args, 'cf-test');

const HOST = String(args.host || '127.0.0.1');
const PORT = Number(args.port || 25577);
const USER = account;
const VERSION = String(args.version || '26.1');
const SERVER = String(args.server || 'towny');
const AMOUNT = Number(args.amount || 100);
if (!Number.isFinite(AMOUNT) || AMOUNT <= 0) die('--amount debe ser un número > 0 (monto mínimo)');
const DELAY = Math.max(0, Number(args.delay != null ? args.delay : 100));
if (!Number.isFinite(DELAY)) die('--delay debe ser numérico (ms)');
const OUT = String(args.out || `out/cf-test-${Date.now()}.json`);

const LOGIN = readSecret(args.login, args['login-file']);

const t0 = Date.now();
const rel = () => Date.now() - t0;

const result = {
  tool: 'cf-test',
  meta: {
    generatedAt: new Date().toISOString(),
    target: { host: HOST, port: PORT },
    account: USER,
    server: SERVER,
    amount: AMOUNT,
    deleteDelayMs: DELAY,
    scope: {
      windowFrom: windowScope.from,
      windowUntil: windowScope.until,
      allowWrites: true,
    },
  },
  balances: [],
  windows: [],
  chat: [],
  events: [],
  errors: [],
  outcome: {},
};

function ev(kind, detail) {
  const e = { t: rel(), kind, detail: detail == null ? null : String(detail).slice(0, 500) };
  result.events.push(e);
  console.log(`[${String(e.t).padStart(6)} ms] ${kind}${e.detail ? ': ' + e.detail : ''}`);
}

function err(where, e) {
  const msg = e && e.message ? e.message : String(e);
  result.errors.push({ t: rel(), where, message: msg.slice(0, 300) });
  console.error(`[!] ${where}: ${msg}`);
}

function saveAndExit(code, why) {
  result.outcome.exitCode = code;
  result.outcome.reason = why;
  result.outcome.elapsedMs = rel();
  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
    console.log(`[ok] evidencia: ${OUT}`);
  } catch (e) {
    console.error(`[!] no se pudo escribir ${OUT}: ${e.message}`);
  }
  try { bot.quit(); } catch {}
  setTimeout(() => process.exit(code), 300);
}

// ---------------------------------------------------------------- conexión

const bot = mineflayer.createBot({
  host: HOST,
  port: PORT,
  username: USER,
  auth: 'offline',
  version: VERSION,
  hideErrors: false,
  checkTimeoutInterval: 120000,
});

bot.physicsEnabled = false;

const client = bot._client;
const origWrite = client.write.bind(client);
let droppedMoves = 0;
client.write = (name, params) => {
  if (/^(position|position_look|look|flying|player_input)$/.test(name)) {
    droppedMoves++;
    return true;
  }
  return origWrite(name, params);
};

let transferSent = false;
let enteredTowny = false;
let currentWindow = null;

bot.on('message', (msg, position) => {
  let text = '';
  try { text = msg && msg.toString ? msg.toString() : String(msg); } catch { text = String(msg); }
  if (!text) return;
  if (result.chat.length < 400) result.chat.push({ t: rel(), text: text.slice(0, 500) });
  console.log(`[chat] ${text.slice(0, 220)}`);
});

bot.on('windowOpen', (window) => {
  currentWindow = window;
  const rec = { t: rel(), type: window.type, slots: [] };
  for (const [slot, item] of Object.entries(window.slots || {})) {
    if (!item) continue;
    rec.slots.push({
      slot: Number(slot),
      id: item.name,
      count: item.count,
      name: safeText(item.customName) || item.displayName || item.name,
      lore: (Array.isArray(item.customLore) ? item.customLore : []).map(safeText).filter(Boolean),
    });
  }
  result.windows.push(rec);
  console.log(`[gui] ventana ${window.type} con ${rec.slots.length} ítems`);
});

function safeText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

// ---------------------------------------------------------------- helpers

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waitFor(cond, timeoutMs, label) {
  const start = Date.now();
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (cond()) { clearInterval(poll); resolve(true); }
      else if (Date.now() - start > timeoutMs) { clearInterval(poll); resolve(false); }
    }, 100);
    setTimeout(() => { clearInterval(poll); resolve(false); }, timeoutMs + 50);
  });
}

function parseMoney(text) {
  const s = String(text);
  // El servidor usa small caps: "ʙᴀɴᴄᴏ • ᴛɪᴇɴᴇꜱ 240$".
  if (!/banco|ʙᴀɴᴄᴏ|tienes|ᴛɪᴇɴᴇꜱ|saldo|balance/i.test(s)) return null;
  const m = s.match(/([\d.,]+)\s*\$/);
  if (!m) return null;
  const raw = m[1];
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  let normalized;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thousands = dec === '.' ? /,/g : /\./g;
    normalized = raw.replace(thousands, '').replace(dec, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = raw.split(sep);
    normalized = parts.length > 1 && parts[parts.length - 1].length === 3
      ? parts.join('')
      : raw.replace(sep, '.');
  } else {
    normalized = raw;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

async function readBalance(label) {
  const before = result.chat.length;
  bot.chat('/money');
  const start = Date.now();
  let value = null;
  while (Date.now() - start < 4000) {
    await sleep(200);
    for (let i = before; i < result.chat.length; i++) {
      const v = parseMoney(result.chat[i].text);
      if (v != null) { value = v; break; }
    }
    if (value != null) break;
  }
  const rec = { at: new Date().toISOString(), t: rel(), label, value };
  result.balances.push(rec);
  console.log(`[money] ${label}: ${value}`);
  return value;
}

function findSlot(predicate) {
  if (!currentWindow) return null;
  for (const [slot, item] of Object.entries(currentWindow.slots || {})) {
    if (!item) continue;
    const hay = `${safeText(item.customName)} ${safeText(item.customLore)} ${item.name}`;
    if (predicate(hay, Number(slot), item)) return Number(slot);
  }
  return null;
}

function findSlotByName(re) {
  if (!currentWindow) return null;
  for (const [slot, item] of Object.entries(currentWindow.slots || {})) {
    if (item && re.test(safeText(item.customName))) return Number(slot);
  }
  return null;
}

async function click(slot, label) {
  console.log(`[click] ${label} (slot ${slot})`);
  await bot.clickWindow(slot, 0, 0);
  await sleep(700);
}

// ---------------------------------------------------------------- secuencia

bot.once('spawn', async () => {
  ev('spawn', 'lobby');
  if (LOGIN) {
    bot.chat(`/login ${LOGIN}`);
    ev('login', '/login ****');
  }
  await sleep(3500);
  if (!transferSent) {
    transferSent = true;
    ev('transfer', `/server ${SERVER}`);
    bot.chat(`/server ${SERVER}`);
  }
});

// La llegada al backend se detecta por el paquete login o por un segundo spawn.
bot._client.on('login', () => {
  if (!transferSent || enteredTowny) return;
  enteredTowny = true;
  ev('towny_login', 'entered play');
  setTimeout(runTest, 2500);
});

bot.on('spawn', () => {
  if (!transferSent || enteredTowny) return;
  enteredTowny = true;
  ev('towny_spawn', 'segundo spawn');
  setTimeout(runTest, 2500);
});

let testStarted = false;
async function runTest() {
  if (testStarted) return;
  testStarted = true;

  try {
    const balance0 = await readBalance('inicial');
    if (balance0 == null) {
      return saveAndExit(10, 'sin lectura de saldo inicial (posible login fallido o economía caída); abortando sin escrituras');
    }

    ev('open_create', '/cf create');
    bot.chat('/cf create');
    const opened = await waitFor(() => currentWindow != null, 5000, 'create window');
    if (!opened) return saveAndExit(5, 'no abrió el menú /cf create');

    // El menú se actualiza; esperar un poco y localizar los slots.
    await sleep(500);
    const slotCreate = findSlot((hay) => /crear coinflip/i.test(hay));
    if (slotCreate == null) return saveAndExit(6, 'no encontré el botón Crear CoinFlip');
    const slotMode = findSlotByName(/modo de juego/i);
    ev('slots', `create=${slotCreate} mode=${slotMode}`);

    // Hacerlo privado para no interactuar con terceros.
    if (slotMode == null) {
      ev('abort', 'no se encontró el toggle de modo');
      return saveAndExit(8, 'sin toggle de privado');
    }
    await click(slotMode, 'modo privado');
    await sleep(700);
    const modeName = safeText(currentWindow?.slots?.[slotMode]?.customName);
    ev('mode_name', modeName);
    if (!/privado/i.test(modeName)) {
      ev('abort', `modo NO confirmado como privado: "${modeName}"`);
      return saveAndExit(7, 'no se pudo confirmar el modo PRIVADO; se aborta para no interactuar con terceros');
    }

    // Crear el coinflip.
    await click(slotCreate, 'crear coinflip');
    await sleep(1200);
    const balance1 = await readBalance('tras crear');

    // Doble delete con delay corto.
    ev('delete_1', '/cf delete');
    bot.chat('/cf delete');
    await sleep(DELAY);
    ev('delete_2', `/cf delete (delay ${DELAY} ms)`);
    bot.chat('/cf delete');
    await sleep(1800);
    const balance2 = await readBalance('tras delete x2');

    // Limpieza: si quedó activo, borrar otra vez.
    bot.chat('/cf delete');
    await sleep(1200);
    const balance3 = await readBalance('tras limpieza');

    const expectedAfterCreate = balance0 != null ? balance0 - AMOUNT : null;
    const expectedAfterRefund = balance0;
    // Criterio sobre balance2 y también balance3: un reembolso doble que
    // llegara tarde (>1.8 s) solo aparecería en la lectura de limpieza.
    const suspected = balance0 != null &&
      ((balance2 != null && balance2 > expectedAfterRefund) ||
       (balance3 != null && balance3 > expectedAfterRefund));

    result.outcome = {
      ...result.outcome,
      balance0,
      balance1,
      balance2,
      balance3,
      amount: AMOUNT,
      expectedAfterCreate,
      expectedAfterRefund,
      delta: balance0 != null && balance2 != null ? balance2 - balance0 : null,
      suspectedDoubleRefund: Boolean(suspected),
      droppedMoves,
      note: suspected
        ? 'El saldo final supera el inicial: posible reembolso doble.'
        : 'Sin evidencia de reembolso doble en esta corrida.',
    };
    ev('result', JSON.stringify(result.outcome));
    saveAndExit(0, 'test complete');
  } catch (e) {
    err('runTest', e);
    saveAndExit(9, 'error en la secuencia');
  }
}

bot.on('kicked', (reason) => {
  const text = safeText(reason);
  result.outcome.kicked = text;
  ev('kicked', text);
  saveAndExit(10, 'expulsado');
});

bot.on('error', (e) => err('bot', e));
bot.on('end', (reason) => {
  result.outcome.end = String(reason);
  ev('end', reason);
  if (!testStarted) saveAndExit(11, 'conexión terminada antes del test');
});

setTimeout(() => {
  if (!result.outcome.exitCode) saveAndExit(12, 'tiempo total agotado');
}, 120000);
