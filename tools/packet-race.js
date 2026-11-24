// packet-race.js — M5: reorden/delay de clics crudos en una GUI.
// Requiere --window-from/--window-until (ISO con offset), --allow-writes y
// cuenta autorizada (tools/lib/mc.js). Máx. 4 clics: sin flooding.
//
// 2026-11-23: los clics usan los campos REALES del protocolo (mouseButton /
// cursorItem; antes todo salía serializado como clic izquierdo), llevan el
// stateId trackeado del servidor, se valida que la ventana siga abierta antes
// de cada clic, y --reorder invierte TAMBIÉN los delays (antes revertir el
// array con delays propios producía la misma secuencia temporal: no-op).
'use strict';

const path = require('path');
const {
  parseArgs, die, readSecret, requireWindow, requireWrites, requireAccount,
  sleep, connect, snapshotInventory, waitForWindow, rawClick, saveJson,
} = require('./lib/mc');

const args = parseArgs(process.argv.slice(2));
const account = requireAccount(args);
const windowScope = requireWindow(args);
requireWrites(args, 'packet-race');

const USER = account;
const LOGIN = readSecret(args.login, args['login-file']);
const OPEN = String(args.open || '');
const REORDER = args.reorder === true;
const FLUSH_QUIT = args['flush-then-quit'] === true;
const OUT = String(args.out || path.join('out', `packet-race-${Date.now()}.json`));

function parseClicks(s) {
  return String(s || '').split(',').filter(Boolean).map((p) => {
    const [slot, button = 0, mode = 0, delayMs = 0] = p.split(':').map(Number);
    return { slot, button, mode, delayMs };
  });
}

const CLICKS = parseClicks(args.clicks);
if (!CLICKS.length) die('--clicks vacío (formato slot:button:mode:delayMs,...)');
if (!OPEN) die('falta --open <comando que abre la GUI>');
if (CLICKS.length > 4) die('máximo 4 clics por corrida (sin flooding)');
for (const c of CLICKS) {
  if (!Number.isInteger(c.slot) || c.slot < 0) die(`slot inválido: "${c.slot}"`);
  if (![0, 1].includes(c.button)) die(`button inválido: "${c.button}" (0=izq, 1=der)`);
  if (!Number.isInteger(c.mode) || c.mode < 0 || c.mode > 6) die(`mode inválido: "${c.mode}" (0-6)`);
  if (!Number.isFinite(c.delayMs) || c.delayMs < 0) die(`delayMs inválido: "${c.delayMs}"`);
}

// Con --reorder se invierte el orden de los clics PERO los delays se quedan
// pegados a los huecos temporales (t0, t1, ...): así la secuencia temporal
// realmente cambia. Antes: reverse() con delay propio por clic = mismo orden.
const delays = CLICKS.map((c) => c.delayMs || 0);
const order = REORDER
  ? [...CLICKS].reverse().map((c, i) => ({ ...c, delayMs: delays[i] }))
  : CLICKS;

const result = {
  tool: 'packet-race',
  meta: {
    generatedAt: new Date().toISOString(),
    account,
    window: windowScope,
    open: OPEN,
    clicks: order,
    reorder: REORDER,
    flushQuit: FLUSH_QUIT,
  },
  chat: [],
  events: [],
  windows: [],
  sent: [],
  phases: [],
  errors: [],
};

async function run() {
  const c = await connect({
    username: USER, login: LOGIN,
    server: args.server || 'towny',
    direct: args.direct, host: args.host, port: args.port, version: args.version,
  });
  const { bot, chat } = c;
  result.meta.loginVerified = c.loginVerified;
  result.events.push(...c.events);
  result.phases.push({ phase: 'before', inventory: snapshotInventory(bot) });

  console.log(`[send] ${OPEN}`);
  bot.chat(OPEN);
  const win = await waitForWindow(bot, 6000);
  if (!win) throw new Error('no abrió la GUI');

  const rec = { at: new Date().toISOString(), type: win.type, slots: [] };
  for (const [slot, item] of Object.entries(win.slots || {})) {
    if (!item) continue;
    rec.slots.push({ slot: Number(slot), id: item.name });
  }
  result.windows.push(rec);

  // Si un clic cierra la GUI, los clics restantes quedan marcados skipped en
  // la evidencia en vez de viajar a una windowId muerta.
  let windowGone = false;
  const onClose = () => { windowGone = true; };
  bot.on('windowClose', onClose);

  const timers = [];
  for (const click of order) {
    const fire = () => {
      if (windowGone) {
        result.sent.push({ at: new Date().toISOString(), ...click, ok: false, reason: 'ventana cerrada antes del clic' });
        return;
      }
      const res = rawClick(bot, win, click);
      result.sent.push({ at: new Date().toISOString(), ...click, ok: res.ok, reason: res.reason });
    };
    timers.push(setTimeout(fire, click.delayMs || 0));
  }

  // --flush-then-quit: el quit compite con el último clic (no espera el
  // asentamiento extra de 2 s). Sin él, dejamos que el server procese.
  const wait = Math.max(...delays) + (FLUSH_QUIT ? 150 : 2000);
  await sleep(wait);

  for (const t of timers) clearTimeout(t);
  bot.removeListener('windowClose', onClose);
  result.chat = chat.slice(-160);
  result.phases.push({
    phase: FLUSH_QUIT ? 'flush-quit' : 'after',
    inventory: snapshotInventory(bot),
  });

  try { bot.quit(); } catch { /* ya cerrado */ }
  await sleep(800);
  saveJson(OUT, result);
}

run().catch((e) => {
  console.error('[!] error:', e.message);
  result.errors.push(e.message);
  result.chat = result.chat.slice(-160);
  saveJson(OUT, result);
  process.exit(1);
});
