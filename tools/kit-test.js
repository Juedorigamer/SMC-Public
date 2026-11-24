// kit-test.js — M4: bypass de cooldown de kit.
// Requiere --window-from/--window-until (ISO con offset), --allow-writes y
// cuenta autorizada (tools/lib/mc.js). Sin eso no conecta.
//
// Modos:
//   relog   reclama, se desconecta por completo, reconecta y reclama otra vez
//           (mide si el cooldown sobrevive a un relog).
//   backend reclama, cambia /server lobby y vuelve a /server towny DENTRO DE
//           LA MISMA CONEXIÓN, y reclama otra vez (mide si el cooldown se
//           resetea con el flip de backend, SIN relog). Hasta 2026-11-23 este
//           modo hacía el flip después de un quit y terminaba midiendo lo
//           mismo que el relog (variable confundida).
'use strict';

const path = require('path');
const {
  parseArgs, die, readSecret, requireWindow, requireWrites, requireAccount,
  sleep, connect, snapshotInventory, waitForWindow, clickSlot, saveJson,
} = require('./lib/mc');

const args = parseArgs(process.argv.slice(2));
const account = requireAccount(args);
const windowScope = requireWindow(args);
requireWrites(args, 'kit-test');

const USER = account;
const LOGIN = readSecret(args.login, args['login-file']);
const KIT_SLOT = Number(args['kit-slot'] != null ? args['kit-slot'] : 19);
if (!Number.isInteger(KIT_SLOT) || KIT_SLOT < 0) die('--kit-slot debe ser un entero >= 0');
const MODE = String(args['relog-mode'] || 'relog');
if (!['relog', 'backend'].includes(MODE)) die('--relog-mode debe ser relog o backend');
const ITEM = String(args.item || 'bread');
const SERVER = String(args.server || 'towny');
const OUT = String(args.out || path.join('out', `kit-${MODE}-${Date.now()}.json`));

const connCfg = () => ({
  username: USER,
  login: LOGIN,
  server: SERVER,
  direct: args.direct,
  host: args.host,
  port: args.port,
  version: args.version,
});

const result = {
  tool: 'kit-test',
  meta: {
    generatedAt: new Date().toISOString(),
    account,
    window: windowScope,
    kitSlot: KIT_SLOT,
    mode: MODE,
    item: ITEM,
    server: SERVER,
  },
  phases: [],
  chat: [],
  events: [],
  errors: [],
};

function collect(c, label) {
  result.events.push(...c.events.map((e) => ({ session: label, ...e })));
  result.chat.push(...c.chat.slice(-80));
}

// Reclama el kit (abre /kitpreview y clic en KIT_SLOT) sobre UNA conexión viva.
async function claimKit(bot, prefix) {
  bot.chat('/kitpreview');
  const win = await waitForWindow(bot, 6000);
  if (!win) throw new Error(`${prefix}: no abrió /kitpreview`);
  const item = win.slots[KIT_SLOT];
  result.phases.push({
    phase: `${prefix}-window`,
    kit: item
      ? { id: item.name, text: JSON.stringify({ n: item.customName, l: item.customLore }).slice(0, 300) }
      : null,
  });
  await clickSlot(bot, KIT_SLOT, 0, 0);
  await sleep(1500);
  result.phases.push({ phase: `${prefix}-after`, inventory: snapshotInventory(bot) });
}

async function run() {
  const first = await connect(connCfg());
  if (first.loginVerified === false) result.errors.push('login no verificado en la primera sesión');
  result.phases.push({ phase: 'first-before', inventory: snapshotInventory(first.bot) });
  await claimKit(first.bot, 'first');

  if (MODE === 'backend') {
    // Flip de backend SIN relog: lobby → towny dentro de la misma conexión.
    first.bot.chat('/server lobby');
    await sleep(4000);
    first.bot.chat(`/server ${SERVER}`);
    await new Promise((resolve) => {
      let done = false;
      let to = null;
      const fin = () => { if (done) return; done = true; clearTimeout(to); resolve(); };
      first.bot._client.once('login', fin);
      first.bot.once('spawn', fin);
      to = setTimeout(fin, 12000);
    });
    await sleep(3000);
    result.phases.push({ phase: 'backend-flip', inventory: snapshotInventory(first.bot) });
    await claimKit(first.bot, 'second-backend');
    collect(first, 'first');
    try { first.bot.quit(); } catch { /* ya cerrado */ }
    await sleep(1200);
  } else {
    // Relog completo: desconecta y reconecta.
    collect(first, 'first');
    try { first.bot.quit(); } catch { /* ya cerrado */ }
    await sleep(2500);

    const second = await connect(connCfg());
    if (second.loginVerified === false) result.errors.push('login no verificado en la segunda sesión');
    result.phases.push({ phase: 'second-before', inventory: snapshotInventory(second.bot) });
    await claimKit(second.bot, 'second');
    collect(second, 'second');
    try { second.bot.quit(); } catch { /* ya cerrado */ }
    await sleep(1200);
  }

  // --- resumen ---
  const inv = (phase) => {
    const p = result.phases.find((x) => x.phase === phase);
    return p ? p.inventory : null;
  };
  const count = (snap, name) => {
    if (!snap) return null;
    return (snap.slots || []).filter((s) => s.name === name).reduce((a, s) => a + s.count, 0);
  };
  const firstAfter = count(inv('first-after'), ITEM);
  const secondAfter = count(inv(MODE === 'relog' ? 'second-after' : 'second-backend-after'), ITEM);
  result.summary = { item: ITEM, firstAfter, secondAfter };

  if (firstAfter == null || secondAfter == null) {
    result.summary.delta = null;
    result.summary.suspectedCooldownBypass = null;
    result.summary.note = 'sin snapshot completo: no se concluye nada';
  } else {
    result.summary.delta = secondAfter - firstAfter;
    if (firstAfter === 0 && secondAfter === 0) {
      // El kit no entrega ITEM (o el slot no era el kit): falso negativo
      // silencioso si se concluyera "no bypass".
      result.summary.suspectedCooldownBypass = null;
      result.summary.note = `sin ${ITEM} en ningún snapshot: el kit no entrega ese ítem (--item) o el slot ${KIT_SLOT} no es el kit; no se concluye nada`;
    } else {
      result.summary.suspectedCooldownBypass = result.summary.delta > 0;
      result.summary.note = result.summary.delta > 0
        ? 'delta > 0: el segundo reclamo entregó de nuevo (posible bypass de cooldown)'
        : 'delta <= 0: el cooldown persistió';
    }
  }

  console.log('[result]', JSON.stringify(result.summary));
  saveJson(OUT, result);
}

run().catch((e) => {
  console.error('[!] error:', e.message);
  result.errors.push(e.message);
  result.chat = result.chat.slice(-160);
  saveJson(OUT, result);
  process.exit(1);
});
