// packet-race.js — referencia para la raza de packet-delay (M1/M5).
// NO está conectado al bot; es la plantilla de tools/packet-race.js.
// Envía window_click crudo con delay/reorden/flush, y snapshot de inventario/saldo.
// Límite: máximo 4 clics, sin flooding.
'use strict';

const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');

const args = process.argv.slice(2).reduce((a, c, i, arr) => {
  if (c.startsWith('--')) { const k = c.slice(2); const n = arr[i + 1]; a[k] = n && !n.startsWith('--') ? n : true; }
  return a;
}, {});

// Parse: --clicks "slot:button:mode:delayMs,slot:button:mode:delayMs"
// button: 0=left, 1=right. mode: 0=pickup, 1=shift, 2=key, 3=drop, 4=drag, 5=double.
function parseClicks(s) {
  return String(s || '').split(',').filter(Boolean).map((p) => {
    const [slot, button = 0, mode = 0, delayMs = 0] = p.split(':').map(Number);
    return { slot, button, mode, delayMs };
  });
}

const HOST = String(args.host || '127.0.0.1');
const PORT = Number(args.port || 25577);
const USER = String(args.username || 'Auditor');
const VERSION = String(args.version || '26.1');
const SERVER = String(args.server || 'towny');
const LOGIN = args['login-file'] ? fs.readFileSync(String(args['login-file']), 'utf8').split(/\r?\n/)[0].trim() : null;
const OPEN = String(args.open || '');          // comando que abre la GUI
const CLICKS = parseClicks(args.clicks);
const REORDER = Boolean(args.reorder);         // soltar en orden inverso
const FLUSH_QUIT = Boolean(args['flush-then-quit']);
const OUT = String(args.out || `out/packet-race-${Date.now()}.json`);

const bot = mineflayer.createBot({ host: HOST, port: PORT, username: USER, auth: 'offline', version: VERSION, hideErrors: false });
bot.physicsEnabled = false;

const client = bot._client;
const origWrite = client.write.bind(client);
client.write = (name, params) => {
  if (/^(position|position_look|look|flying|player_input)$/.test(name)) return true; // freeze
  return origWrite(name, params);
};

const result = { meta: { user: USER, open: OPEN, clicks: CLICKS, reorder: REORDER, flushQuit: FLUSH_QUIT }, chat: [], errors: [] };
let entered = false;
let snapshotBefore = null;

function snap() {
  return bot.inventory.items().map((i) => ({ slot: i.slot, name: i.name, count: i.count }));
}

bot.on('message', (m) => { try { result.chat.push(m.toString().slice(0, 400)); } catch {} });

// Enviar un clic crudo con el sync-id de la ventana abierta.
function rawClick(win, click) {
  const params = {
    windowId: win.id,
    stateId: win.stateId ?? 0,
    slot: click.slot,
    button: click.button,
    mode: click.mode,
    changedSlots: [],
    carriedItem: { present: false },
  };
  client.write('window_click', params);
}

function flushClicks(win) {
  const order = REORDER ? [...CLICKS].reverse() : CLICKS;
  // Delay individual: se encola con setTimeout; si delayMs=0 se envía en el mismo tick.
  order.forEach((c) => {
    setTimeout(() => rawClick(win, c), c.delayMs || 0);
  });
}

async function run() {
  snapshotBefore = snap();
  result.snapshotBefore = snapshotBefore;
  if (OPEN) bot.chat(OPEN);

  await new Promise((resolve) => {
    const to = setTimeout(resolve, 4000);
    bot.once('windowOpen', (win) => {
      clearTimeout(to);
      flushClicks(win);
      const quitAt = Math.max(...CLICKS.map((c) => c.delayMs || 0)) + (FLUSH_QUIT ? 0 : 1500);
      setTimeout(resolve, quitAt);
    });
  });

  if (FLUSH_QUIT) {
    bot.quit();
    result.outcome = { flushQuit: true, snapshotBefore, snapshotAfter: null };
  } else {
    result.snapshotAfter = snap();
    result.outcome = { flushQuit: false, snapshotBefore, snapshotAfter: result.snapshotAfter };
    bot.quit();
  }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`[ok] ${OUT}`);
}

bot.once('spawn', async () => {
  if (LOGIN) { bot.chat(`/login ${LOGIN}`); await new Promise((r) => setTimeout(r, 3000)); }
  bot.chat(`/server ${SERVER}`);
  setTimeout(() => { entered = true; run(); }, 2500);
});
bot.on('error', (e) => { result.errors.push(e.message); });
setTimeout(() => process.exit(0), 60000);
