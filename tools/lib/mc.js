// mc.js — helpers compartidos para las herramientas de prueba (autorizadas).
// No conecta por sí solo: cada tool decide cuándo y con qué guardas.
//
// Guardas (endurecidas 2026-11-23 tras la revisión de código):
//  - requireAccount SOLO acepta cuentas de ALLOWED_ACCOUNTS. --allowed-account
//    ya no autoriza nada (era auto-referencial: cualquiera podía pasarlo).
//  - requireWindow exige fechas ISO CON zona horaria explícita (sin offset se
//    interpretaban en hora local y la franja corría desplazada).
//  - requireWrites exige el flag literal --allow-writes. "--allow-writes false"
//    ya no pasa (el string truthy era un bypass).
'use strict';

const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');

const ROOT = path.join(__dirname, '..', '..');

// Allowlist OPCIONAL de cuentas para las tools en vivo: archivo de texto
// `tools/lib/accounts.txt` (una cuenta por línea, `#` comentarios). Si existe,
// las tools solo aceptan las cuentas listadas — pensado para auditorías
// autorizadas, donde un script no debería poder correrse con otra cuenta.
// Si no existe, cualquier cuenta no vacía pasa (con advertencia).
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.txt');

function allowedAccounts() {
  try {
    const buf = fs.readFileSync(ACCOUNTS_FILE);
    if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) return [];
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'));
  } catch {
    return [];
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 2) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function die(msg, code = 2) {
  console.error(`[!] ${msg}`);
  process.exit(code);
}

function readSecret(arg, file) {
  if (file) {
    let buf;
    try {
      buf = fs.readFileSync(String(file));
    } catch (e) {
      die(`no se pudo leer ${file}: ${e.message}`);
    }
    if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
      die(`${file} está en UTF-16 (redirección de PowerShell): guardalo como UTF-8; si no, el login fallaría en silencio`);
    }
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM UTF-8
    const val = text.split(/\r?\n/)[0].trim();
    if (!val) die(`${file} está vacío: no hay login que leer`);
    return val;
  }
  if (typeof arg === 'string' && arg) {
    console.error('[!] aviso: --login deja la contraseña visible en la lista de procesos; preferí --login-file');
    return arg;
  }
  return null;
}

function checkWindow(from, until) {
  if (!from || !until) return { ok: false, reason: 'faltan --window-from y --window-until' };
  const hasOffset = (s) => /(Z|[+-]\d{2}:?\d{2})\s*$/.test(String(s).trim());
  if (!hasOffset(from) || !hasOffset(until)) {
    return {
      ok: false,
      reason: 'las fechas deben ser ISO con zona horaria explícita (p. ej. 2026-11-23T14:00:00-03:00); sin offset se interpretan en hora local',
    };
  }
  const a = Date.parse(String(from));
  const b = Date.parse(String(until));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, reason: 'fechas inválidas (usar ISO)' };
  if (a >= b) return { ok: false, reason: 'la ventana termina antes de empezar' };
  const now = Date.now();
  if (now < a) return { ok: false, reason: `antes de la ventana (${from})` };
  if (now > b) return { ok: false, reason: `después de la ventana (${until})` };
  return { ok: true, from: new Date(a).toISOString(), until: new Date(b).toISOString() };
}

function requireWindow(args) {
  const w = checkWindow(args['window-from'], args['window-until']);
  if (!w.ok) die(`fuera de ventana: ${w.reason}. No se conecta.`, 3);
  return w;
}

function requireWrites(args, tool) {
  if (args['allow-writes'] !== true) {
    die(`${tool} modifica estado; requiere --allow-writes (flag sin valor) y autorización escrita. No se conecta.`, 4);
  }
}

function requireAccount(args) {
  const acc = String(args.account || args.username || '');
  if (!acc) die('falta --account/--username (la cuenta con la que se conecta el bot)', 5);
  const list = allowedAccounts();
  if (list.length) {
    if (!list.includes(acc)) {
      die(`cuenta "${acc}" no está en tools/lib/accounts.txt (permitidas: ${list.join(', ')}). No se conecta.`, 5);
    }
    return acc;
  }
  console.warn('[!] sin tools/lib/accounts.txt: la tool corre con cualquier cuenta no vacía. Para auditorías autorizadas, listá ahí las cuentas permitidas.');
  return acc;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function clean(t) {
  return String(t == null ? '' : t)
    .replace(/\u00a7[0-9a-fk-orx]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(text) {
  const s = String(text);
  if (!/banco|ʙᴀɴᴄᴏ|tienes|ᴛɪᴇɴᴇꜱ|saldo|balance/i.test(s)) return null;
  // Último monto de la línea, con signo: "transferiste 100$ ... quedan 900$"
  // debe dar 900, y "banco: -500$" debe dar -500 (Towny permite saldos negativos).
  const re = /(-?[\d.,]+)\s*\$/g;
  let m;
  let raw = null;
  while ((m = re.exec(s)) !== null) raw = m[1];
  if (raw == null) return null;
  const ld = raw.lastIndexOf('.');
  const lc = raw.lastIndexOf(',');
  let norm;
  if (ld >= 0 && lc >= 0) {
    const dec = ld > lc ? '.' : ',';
    const th = dec === '.' ? /,/g : /\./g;
    norm = raw.replace(th, '').replace(dec, '.');
  } else if (ld >= 0 || lc >= 0) {
    const sep = ld >= 0 ? '.' : ',';
    const parts = raw.split(sep);
    norm = parts.length > 1 && parts[parts.length - 1].length === 3 ? parts.join('') : raw.replace(sep, '.');
  } else {
    norm = raw;
  }
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

function snapshotInventory(bot) {
  const slots = [];
  try {
    for (const it of bot.inventory.items()) slots.push({ slot: it.slot, name: it.name, count: it.count });
  } catch { /* sin inventario aún */ }
  return { at: new Date().toISOString(), slots };
}

function findItem(bot, name) {
  try { return bot.inventory.items().find((i) => i.name === name) || null; } catch { return null; }
}

// Mueve un ítem a la hotbar. Sin index explícito busca el primer slot libre
// (36-44) para no permutar el inventario (moveSlotItem con destino ocupado
// hace swap, no move). Devuelve el slot de destino.
async function moveToHotbar(bot, item, index = null) {
  if (!item) throw new Error('item nulo');
  let dest = null;
  if (Number.isInteger(index) && index >= 0 && index <= 8) {
    dest = 36 + index;
  } else {
    try {
      const used = new Set(bot.inventory.items().filter((i) => i.slot >= 36 && i.slot <= 44).map((i) => i.slot));
      for (let s = 36; s <= 44; s++) {
        if (!used.has(s)) { dest = s; break; }
      }
    } catch { /* sin inventario aún */ }
    if (dest == null) dest = 36; // último recurso: permuta con el slot 0
  }
  if (item.slot === dest) return dest;
  await bot.moveSlotItem(item.slot, dest);
  await sleep(300);
  return dest;
}

function attachFreeze(bot) {
  bot.physicsEnabled = false;
  const c = bot._client;
  const orig = c.write.bind(c);
  c.write = (name, params) => {
    if (/^(position|position_look|look|flying|player_input)$/.test(name)) return true;
    return orig(name, params);
  };
}

function waitForWindow(bot, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    let to = null;
    const fin = (w) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      resolve(w || null);
    };
    bot.once('windowOpen', fin);
    to = setTimeout(() => fin(null), timeoutMs);
  });
}

async function connect(cfg) {
  const direct = Boolean(cfg.direct);
  const host = direct ? String(cfg.host || 'mc.ejemplo.com') : '127.0.0.1';
  const port = direct ? Number(cfg.port || 25565) : 25577;
  const version = String(cfg.version || '26.1');

  const bot = mineflayer.createBot({
    host, port,
    username: cfg.username,
    auth: 'offline',
    version,
    hideErrors: false,
    checkTimeoutInterval: 120000,
  });
  attachFreeze(bot);

  // stateId real del servidor: mineflayer lo trackea en un closure propio y
  // no lo expone; lo trackeamos igual (window_items / set_slot lo llevan).
  const mcState = { stateId: 0 };
  try {
    const upd = (p) => { if (p && Number.isFinite(p.stateId)) mcState.stateId = p.stateId; };
    bot._client.on('window_items', upd);
    bot._client.on('set_slot', upd);
  } catch { /* cliente aún no listo */ }
  bot._mcState = mcState;

  const chat = [];
  bot.on('message', (m) => {
    try { chat.push(clean(m.toString())); } catch { /* ignore */ }
  });
  const events = [];
  bot.on('kicked', (r) => events.push({ kind: 'kicked', detail: String(r).slice(0, 300) }));
  bot.on('end', (r) => events.push({ kind: 'end', detail: String(r) }));

  await new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('timeout esperando spawn (lobby)'));
    }, 30000);
    const ok = () => { if (done) return; done = true; clearTimeout(to); resolve(); };
    const bad = (e) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    bot.once('spawn', ok);
    bot.once('error', bad);
    bot.once('end', (r) => bad(new Error(`conexión terminada antes del spawn: ${String(r).slice(0, 200)}`)));
  });

  // Login VERIFICADO: si el server responde con un rechazo de credencial,
  // abortamos sin escrituras en vez de correr el test con una sesión anónima
  // (falso negativo con apariencia de corrida limpia).
  let loginVerified = null;
  if (cfg.login) {
    bot.chat(`/login ${cfg.login}`);
    await sleep(3500);
    if (cfg.verifyLogin === false) {
      loginVerified = 'skip';
    } else {
      const bal = await readBalance(bot, chat, 6000);
      if (bal.value != null) {
        loginVerified = true;
      } else {
        const hint = chat.some((t) => /incorrect|inv[áa]lid[oa]|wrong|no est|not logged|sesi|contrase|demasiados intentos|too many/i.test(t));
        if (hint) throw new Error('login no verificado: el servidor respondió con un mensaje de credencial inválida; abortando sin escrituras');
        loginVerified = false;
        console.warn('[!] sin respuesta de saldo tras /login (login NO confirmado); continuando, revisá la evidencia');
      }
    }
  }

  if (cfg.server && cfg.server !== 'lobby') {
    bot.chat(`/server ${cfg.server}`);
    await new Promise((resolve) => {
      let done = false;
      let to = null;
      const fin = () => { if (done) return; done = true; clearTimeout(to); resolve(); };
      bot._client.once('login', fin);
      bot.once('spawn', fin);
      to = setTimeout(fin, 15000);
    });
    await sleep(2500);
  }

  return { bot, chat, events, loginVerified };
}

async function readBalance(bot, chat, timeoutMs = 4000) {
  const before = chat.length;
  bot.chat('/money');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(200);
    for (let i = before; i < chat.length; i++) {
      const v = parseMoney(chat[i]);
      if (v != null) return { value: v, raw: chat[i] };
    }
  }
  return { value: null, raw: null };
}

async function clickSlot(bot, slot, button = 0, mode = 0) {
  await bot.clickWindow(slot, button, mode);
  await sleep(700);
}

// window_click crudo para pruebas de reorden/delay. Usa los nombres de campo
// REALES del protocolo (mouseButton / cursorItem; los nombres viejos
// button/carriedItem se serializaban como 0 → todo salía como clic izquierdo)
// y el stateId trackeado en connect(). Devuelve {ok, reason} en vez de `true`
// a ciegas: si la ventana cerró o la conexión no es escribible, lo informa.
function rawClick(bot, win, click) {
  try {
    if (bot.currentWindow == null || bot.currentWindow.id !== win.id) {
      return { ok: false, reason: 'ventana cerrada (windowId distinto)' };
    }
    const c = bot._client;
    if (!c.serializer || !c.serializer.writable) {
      return { ok: false, reason: 'conexión no escribible' };
    }
    c.write('window_click', {
      windowId: win.id,
      stateId: bot._mcState && Number.isFinite(bot._mcState.stateId) ? bot._mcState.stateId : 0,
      slot: click.slot,
      mouseButton: click.button || 0,
      mode: click.mode || 0,
      changedSlots: [],
      cursorItem: null,
    });
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message : String(e) };
  }
}

async function safeQuit(bot) {
  try { bot.quit(); } catch { /* ya cerrado */ }
  await sleep(800);
}

function saveJson(out, data) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[ok] evidencia: ${out}`);
}

module.exports = {
  ROOT, allowedAccounts, parseArgs, die, readSecret,
  checkWindow, requireWindow, requireWrites, requireAccount,
  sleep, clean, parseMoney,
  snapshotInventory, findItem, moveToHotbar,
  connect, readBalance, waitForWindow, clickSlot, rawClick, safeQuit, saveJson,
};
