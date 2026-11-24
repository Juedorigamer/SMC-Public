#!/usr/bin/env node
'use strict';

/**
 * SMC — reconocimiento black-box de un servidor de Minecraft.
 *
 * No requiere OP ni permisos: solo lee lo que el servidor le envía a
 * cualquier cliente (status ping, árbol de comandos, registries, canales
 * de plugin, tab-complete).
 *
 * Uso:
 *   node recon.js --host mc.ejemplo.com [--port 25565] [--username Bot]
 *                 [--auth offline|microsoft] [--version auto|1.21.4]
 *                 [--wait 4000] [--stay 0] [--out out/recon.json]
 */

const fs = require('fs');
const path = require('path');
const mc = require('minecraft-protocol');
const mineflayer = require('mineflayer');

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.host) {
  console.log(`
SMC — reconocimiento black-box (sin OP)

  --host <host>            obligatorio
  --port <n>               default 25565
  --username <name>        default ReconBot
  --auth <modo>            offline (default) | microsoft
  --version <ver|auto>     default auto (detección por ping)
  --wait <ms>              espera tras spawn para capturar paquetes (4000)
  --stay <ms>              quedarse conectado tras la captura (0)
  --no-probe               no enviar comandos de sondeo (/version, /plugins, ...)
  --profile <nombre>       generic (default) | towny (agrega probes de Towny)
  --register <pass>        registrarse con AuthMe/nLogin al entrar
  --login <pass>           loguearse con AuthMe/nLogin al entrar
  --register-file <path>   igual que --register pero leyendo el pass de un archivo
  --login-file <path>      igual que --login pero leyendo el pass de un archivo
  --server <nombre>        cambiar de backend en el proxy (/server <nombre>)
  --ping-only              solo status ping público, sin conectar bot
  --tab-sweep              barrer tab-complete por prefijos si se corta en 1000 (más lento)
  --no-tab                 no consultar tab-complete (nivel mínimo)
  --out <archivo>          default out/recon-<host>-<fecha>.json
  --help                   esta ayuda

  Controles de alcance (recomendados en producción):
  --account <etiqueta>     cuenta exenta declarada en la autorización (queda en el JSON)
  --window-from <iso>      inicio de la ventana autorizada, p.ej. 2026-10-26T10:00:00-03:00
  --window-until <iso>     fin de la ventana autorizada
  --allow-writes           desactiva el modo read-only (default: solo lectura)
  --max-commands <n>       tope de comandos por corrida (default 30)
  --min-interval <ms>      intervalo mínimo entre comandos (default 1200)
  --probe-wait <ms>        espera entre sondeos (default 1600)
  --abort-lag <ms>         aborta si la latencia supera el umbral 3 veces seguidas (default 2500)
  --redact                 oculta nombres de jugadores en la salida
  --extra-probe "<cmd>|..." sondeos adicionales separados por | o ; (pasan por el guard)
  --extra-probe-file <f>   igual que --extra-probe, una línea por comando
  --only-extra             ejecuta solo los --extra-probe (no la lista base)
  --tab "<q>;;<q>"         consulta tab-complete de esos prefijos (sin ejecutar comandos)
  --tab-file <f>           igual que --tab, una consulta por línea (conserva espacios finales)
  --auth-wait <ms>         espera tras /login o /register (default 3500)
  --decline-pack           rechaza el resource pack en vez de aceptarlo
  --download-pack          descarga el resource pack a packs\ para analizarlo
  --pack-first             descarga el pack ANTES de confirmarlo (como un cliente real)
  --pack-delay <ms>        espera <ms> entre ACCEPTED y SUCCESSFULLY_LOADED (imita la descarga)
  --trace                  registra la secuencia de paquetes del cambio de backend
  --packet-log             registra cada paquete de login/configuración (diagnóstico)
  --freeze                 congela el movimiento del cliente (necesario detrás de ViaProxy:
                           sin esto el backend 26.3 expulsa con "Invalid move player packet")
  --compass                abre el compás del lobby (clic derecho) para leer el menú de modos
  --click-slot <n>         pulsa el botón del slot <n> de la GUI (navegación de menús, no mueve ítems)
  --click-slots <n,n,...>  varios slots; reabre la GUI una vez por slot (requiere --click-window)
  --click-chain <n,n,...>  cadena de clics: cada slot en la ventana que abrió el anterior
  --click-kind <nav|trade> nav (default) solo abre menús; trade compra/vende/reclama
                           y exige --allow-writes + aprobación escrita
  --click-button <l|r>     botón del clic: left (default) o right (venta de 1 en /shop)
  --click-window <cmd>     limita --click-slot a la ventana abierta por <cmd> (p. ej. /shop)
                           sin este flag, --click-slot solo actúa sobre el menú del compás
  --max-windows <n>        tope de ventanas capturadas por corrida (default 8)
`);
  process.exit(args.help ? 0 : 1);
}

const HOST = String(args.host);
const PORT = Number(args.port || 25565);
const USER = String(args.username || 'ReconBot');
const AUTH = String(args.auth || 'offline') === 'microsoft' ? 'microsoft' : 'offline';
const VERSION = args.version && args.version !== 'auto' ? String(args.version) : undefined;
const WAIT = Number(args.wait || 4000);
const STAY = Number(args.stay || 0);
const PROBE = !args['no-probe'];
const TAB_SWEEP = Boolean(args['tab-sweep']);
const NO_TAB = Boolean(args['no-tab']);
const TAB_QUERIES = [
  ...(args.tab
    ? String(args.tab)
        .split(';;')
        .map((s) => s.trim())
        .filter(Boolean)
    : []),
  ...readProbeFile(args['tab-file'], true),
];
const PING_ONLY = Boolean(args['ping-only']);
const PROFILE = String(args.profile || 'generic').toLowerCase();
// Las contraseñas con comillas o caracteres raros se rompen al pasarlas por
// consola, así que también se pueden leer de un archivo (sin echo, sin
// historial). Un solo intento fallido ya puede bloquear la cuenta.
function readSecretArg(value, file) {
  if (!file) return value;
  try {
    // UTF-16 (redirección ">" de PowerShell) o BOM romperían el login en
    // silencio: se detectan antes de usar el contenido.
    const buf = fs.readFileSync(path.resolve(String(file)));
    if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
      console.error(`[!] ${file} está en UTF-16 (redirección de PowerShell): guardalo como UTF-8.`);
      process.exit(2);
    }
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text.replace(/[\r\n]+$/, '');
  } catch (e) {
    console.error(`[!] no pude leer ${file}: ${e.message}`);
    process.exit(1);
  }
}

// Lista de sondeos desde archivo: una línea por comando, `#` comentario.
// Evita que cmd.exe interprete `|` como tubería al pasar por run.cmd.
function readProbeFile(file, keepTrailing = false) {
  if (!file) return [];
  try {
    const buf = fs.readFileSync(path.resolve(String(file)));
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text
      .split(/\r?\n/)
      .map((s) => (keepTrailing ? s : s.trim()))
      .filter((s) => s && !s.startsWith('#'));
  } catch (e) {
    console.error(`[!] no pude leer ${file}: ${e.message}`);
    process.exit(1);
  }
}

const REGISTER = readSecretArg(args.register ? String(args.register) : null, args['register-file']);
const LOGIN = readSecretArg(args.login ? String(args.login) : null, args['login-file']);
const SERVER_TARGET = args.server ? String(args.server) : null;

// Controles de alcance derivados de la autorización escrita.
const ACCOUNT = args.account ? String(args.account) : null;
// La franja es obligatoria para conectar el bot (ping-only no la necesita).
// Se exige zona horaria explícita: sin offset, Date.parse interpreta hora
// local y la "ventana autorizada" corre desplazada.
const ISO_TZ_RE = /(Z|[+-]\d{2}:?\d{2})\s*$/;
for (const name of ['window-from', 'window-until']) {
  const raw = args[name];
  if (raw == null) continue;
  if (typeof raw !== 'string' || !ISO_TZ_RE.test(raw.trim())) {
    console.error(`[!] --${name} debe ser ISO con zona horaria explícita (p. ej. 2026-11-23T14:00:00-03:00): "${raw}"`);
    process.exit(2);
  }
}
const WINDOW_FROM = args['window-from'] != null ? Date.parse(String(args['window-from'])) : null;
const WINDOW_UNTIL = args['window-until'] != null ? Date.parse(String(args['window-until'])) : null;
for (const [flag, val] of [['--window-from', WINDOW_FROM], ['--window-until', WINDOW_UNTIL]]) {
  if (val != null && !Number.isFinite(val)) {
    console.error(`[!] ${flag} no es una fecha ISO válida: "${args[flag.slice(2)]}"`);
    process.exit(2);
  }
}
if (WINDOW_FROM != null && WINDOW_UNTIL != null && WINDOW_FROM >= WINDOW_UNTIL) {
  console.error('[!] la ventana autorizada termina antes de empezar.');
  process.exit(2);
}
const READ_ONLY = !args['allow-writes'];
// Number('0') || 30 daba 30: "--max-commands 0" relajaba el límite en vez
// de estrecharlo.
const MAX_COMMANDS = Number.isFinite(Number(args['max-commands'])) && Number(args['max-commands']) >= 0
  ? Number(args['max-commands'])
  : 30;
const MIN_INTERVAL = Number(args['min-interval'] || 1200);
const PROBE_WAIT = Number(args['probe-wait'] || 1600);
const ABORT_LAG = Number(args['abort-lag'] || 2500);
const REDACT = Boolean(args.redact);
const AUTH_WAIT = Number(args['auth-wait'] || 3500);
const DECLINE_PACK = Boolean(args['decline-pack']);
const DOWNLOAD_PACK = Boolean(args['download-pack']);
const PACK_FIRST = Boolean(args['pack-first']);
const PACK_DELAY = args['pack-delay'] != null ? Number(args['pack-delay']) : 0;
// Detrás de ViaProxy el backend 26.3 expulsa con "Invalid move player packet
// received" si el cliente manda posición/rotación traducidas. Congelar el
// movimiento del cliente mantiene la sesión estable y no cambia lo observado.
const FREEZE = Boolean(args.freeze);
const CLICK_SLOTS = args['click-slots']
  ? String(args['click-slots'])
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0)
  : args['click-slot'] != null
    ? [Number(args['click-slot'])]
    : [];
const CLICK_CHAIN = args['click-chain']
  ? String(args['click-chain'])
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0)
  : [];
const CLICK_WINDOW = args['click-window'] ? String(args['click-window']) : null;
const MAX_WINDOWS = Number.isFinite(Number(args['max-windows'])) && Number(args['max-windows']) >= 1
  ? Math.floor(Number(args['max-windows']))
  : 8;
// Un clic de "trade" puede comprar, vender o reclamar: exige --allow-writes.
// Por defecto todo clic es navegación (abrir una categoría, un submenú).
const CLICK_KIND = String(args['click-kind'] || 'nav').toLowerCase();
const CLICK_BUTTON = /^(r|right)$/i.test(String(args['click-button'] || 'left')) ? 1 : 0;
if (!['nav', 'trade'].includes(CLICK_KIND)) {
  console.error('[!] --click-kind debe ser "nav" o "trade"');
  process.exit(2);
}
if (CLICK_KIND === 'trade' && READ_ONLY) {
  console.error('[!] --click-kind trade requiere --allow-writes (y aprobación escrita)');
  process.exit(4);
}
// Un clic sin ventana explícita conserva el comportamiento histórico: menú del
// compás. Con --click-window no se abre el compás, se navega la GUI indicada.
const COMPASS = Boolean(args.compass) || (CLICK_SLOTS.length > 0 && !CLICK_WINDOW);
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const OUT = args.out
  ? path.resolve(String(args.out))
  : path.join(__dirname, 'out', `recon-${HOST.replace(/[^a-z0-9.-]/gi, '_')}-${stamp()}.json`);

// ---------------------------------------------------------------- estado

const result = {
  meta: {
    tool: 'SMC',
    generatedAt: new Date().toISOString(),
    target: { host: HOST, port: PORT },
    auth: AUTH,
    requestedVersion: VERSION || 'auto',
    profile: PROFILE,
    pingOnly: PING_ONLY,
    scope: {
      account: ACCOUNT,
      username: USER,
      windowFrom: WINDOW_FROM ? new Date(WINDOW_FROM).toISOString() : null,
      windowUntil: WINDOW_UNTIL ? new Date(WINDOW_UNTIL).toISOString() : null,
      readOnly: READ_ONLY,
      maxCommands: MAX_COMMANDS,
      minIntervalMs: MIN_INTERVAL,
      abortLagMs: ABORT_LAG,
      redact: REDACT,
      freeze: FREEZE,
    },
  },
  status: null,
  version: { name: null, protocol: null },
  brand: null,
  brands: [],
  pluginChannels: [],
  commands: { topLevel: [], literalCount: 0, byNamespace: {} },
  recipes: {},
  registries: {},
  tags: {},
  tabComplete: [],
  tabCompleteSwept: false,
  authHints: [],
  authLog: [],
  proxyServers: [],
  serverSwitch: null,
  probes: {},
  chat: [],
  actionbars: [],
  windows: [],
  guiClicks: [],
  packetLog: [],
  login: null,
  logins: [],
  errors: [],
  sentCommands: [],
  blockedCommands: [],
  latencies: [],
  aborted: null,
  resourcePacks: [],
  droppedMoves: 0,
};

const buckets = {
  commands: new Map(),
  recipes: new Map(),
  registries: new Map(),
  tags: new Map(),
};

const pluginChannels = new Set();
const topLevel = new Set();
const chatSamples = [];
let literalCount = 0;
let probeResults = {};
// El primer clic "nav" en read-only vigila el saldo alrededor (ver el
// handler de windowOpen): un clic de "navegación" puede transaccionar según
// el plugin y la semántica la define el servidor, no el flag.
let navBalanceChecked = false;

// ---------------------------------------------------------------- helpers

const NS_RE = /\b([a-z0-9_.-]{2,32}):([a-z0-9_./-]{1,128})\b/g;

// Extrae todos los identificadores "namespace:path" de un paquete, sin
// depender del formato exacto de cada versión del protocolo.
function collectNamespaces(obj, bucket) {
  let raw;
  try {
    raw = JSON.stringify(obj);
  } catch {
    return;
  }
  if (!raw) return;
  NS_RE.lastIndex = 0;
  let m;
  while ((m = NS_RE.exec(raw)) !== null) {
    const ns = m[1];
    if (ns === 'minecraft' || ns === 'brigadier') continue;
    if (!bucket.has(ns)) bucket.set(ns, new Set());
    bucket.get(ns).add(m[2]);
  }
}

function mapToObj(map) {
  const out = {};
  for (const [ns, set] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out[ns] = [...set].sort();
  }
  return out;
}

// Agrupa "namespace:comando" en { namespace: [comandos] }.
function groupNamespaces(list) {
  const map = new Map();
  for (const raw of list || []) {
    const s = String(raw);
    const i = s.indexOf(':');
    if (i <= 0) continue;
    const ns = s.slice(0, i);
    const rest = s.slice(i + 1);
    if (!/^[a-z0-9_.-]{2,32}$/.test(ns) || ns === 'minecraft') continue;
    if (!map.has(ns)) map.set(ns, new Set());
    map.get(ns).add(rest);
  }
  return mapToObj(map);
}

function readVarInt(buf, off) {
  let value = 0;
  let shift = 0;
  let byte;
  do {
    if (off >= buf.length || shift > 35) return null;
    byte = buf[off++];
    value |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [value >>> 0, off];
}

function decodeBrand(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return null;
  const vi = readVarInt(buf, 0);
  if (!vi) return null;
  const [len, off] = vi;
  if (len <= 0 || len > 256 || off + len > buf.length) return null;
  return buf.slice(off, off + len).toString('utf8');
}

// Compatibilidad entre formatos de protocolo: flags numérico (<=1.20.4) y
// flags como objeto con bits nombrados (>=1.20.5). El nombre puede venir en
// `name` o en `extraNodeData.name` según la versión de minecraft-protocol.
function nodeType(node) {
  const f = node && node.flags;
  if (typeof f === 'number') return f & 0x03; // 0=root, 1=literal, 2=argument
  if (f && typeof f === 'object' && typeof f.command_node_type === 'number') return f.command_node_type;
  return -1;
}

function nodeName(node) {
  if (!node) return null;
  if (node.extraNodeData && typeof node.extraNodeData.name === 'string') return node.extraNodeData.name;
  if (typeof node.name === 'string') return node.name;
  return null;
}

// El paquete declare_commands trae el árbol de comandos. OJO: en versiones
// modernas (Paper 1.20.5+) el servidor lo FILTRA por permisos, así que solo
// ves los comandos que tu cuenta puede ejecutar. Sigue siendo útil: revela
// los comandos de plugin que sí tenés permitidos.
function parseCommandTree(p) {
  const nodes = p && (p.nodes || p.commands);
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  const rootIndex = Number.isInteger(p.rootIndex) ? p.rootIndex : 0;
  const topLevel = [];
  const all = new Set();
  const seen = new Set();

  const walk = (idx, depth) => {
    if (!Number.isInteger(idx) || idx < 0 || idx >= nodes.length) return;
    if (seen.has(idx) || depth > 4) return;
    seen.add(idx);
    const node = nodes[idx];
    const type = nodeType(node);
    const name = nodeName(node);
    if (type === 1 && name) {
      all.add(name);
      if (depth === 1) topLevel.push(name);
    }
    const kids = (node && (node.children || node.childrenIndices)) || [];
    if (Array.isArray(kids)) for (const c of kids) walk(c, depth + 1);
  };

  walk(rootIndex, 0);
  return { topLevel: [...new Set(topLevel)], all: [...all] };
}

// Quita códigos de color de Minecraft (§a, §l, etc.) y espacios sobrantes.
function clean(text) {
  return String(text == null ? '' : text)
    .replace(/\u00a7[0-9a-fk-orx]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms, label) {
  // El timer se limpia cuando gana cualquiera de las dos: antes quedaban
  // timers vivos hasta agotarse (el sweep de tab-complete acumulaba decenas).
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`timeout ${label || ''} (${ms}ms)`)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------- alcance

// Comandos que modifican estado. En modo read-only (default) no se envían
// nunca. La lista es amplia a propósito: ante la duda, se bloquea.
// 2026-11-23: se agregan los aliases que antes se colaban en read-only
// (/town deposit —solo estaba la forma corta /t—, /auctionhouse = /ah,
// /sellall = /sell-all, /item, /i, la familia /tpa, /sethome) y se normaliza
// el prefijo de namespace antes de los guards: /essentials:pay ejecuta el
// mismo handler que /pay.
const WRITE_CMD_RE =
  /^\/(pay|eco|give|item|i|take|clear|kill|tp|teleport|tpa|tpahere|tpaccept|tpdeny|sethome|setblock|fill|clone|summon|gamerule|time|weather|op|deop|ban|kick|mute|warn|sell|buy|deposit|withdraw|auction|auctionhouse|ah|kit|rankup|maxrankup|prestige|prestiges|reforge|reforges|sellall|sell-all|sell-hand|sellhand|sell-handall|sellhandall|zshop-sell-all|zshop-hand|zshop-handall|voteparty|voteshop|voteall|vpoints|vtoday|vshop|vstreak|votestreak|votetoday|votepoints|(?:is|island)\s+(?:create|delete|reset|bank|upgrade|invite|kick|promote|demote|transfer|sethome|setwarp|warp|coop|uncoop|trust|untrust|ban|unban|leave|join)|t\s+(?:deposit|withdraw|set|add|remove|claim|unclaim|new|delete|plot|outpost|toggle)|plot\s+(?:claim|unclaim|set|add|remove|clear)|town\s+(?:deposit|withdraw|bank|add|remove|claim|unclaim|set|new|delete|leave|purge|mayor)|nation\s+(?:deposit|withdraw|add|remove|set|new|delete)|res\s+(?:create|delete|set|remove))\b/i;

// /plugin:subcomando usa el mismo handler que la forma corta: se normaliza
// antes de testear los guards (antes /essentials:pay pasaba por el anclaje ^\/).
function stripNamespace(cmd) {
  return String(cmd).trim().replace(/^\/([a-z0-9_.-]+):(?=[a-z])/i, '/');
}

// Coinflip: `/cf` y `/coinflip` pueden abrir un menú (solo lectura) o apostar.
// En read-only se permiten las subcomandas informativas, la forma desnuda y
// `create` sin monto (abre el menú). Cualquier otra forma (monto, delete,
// invite, withdraw, refund) se bloquea porque mueve dinero o interactúa.
const COINFLIP_READONLY_RE =
  /^\/(?:cf|coinflip)\s+(?:help|info|history|stats|leaderboard|settings|limit)\b/i;
const COINFLIP_CREATE_BARE_RE = /^\/(?:cf|coinflip)\s+create\s*$/i;
const COINFLIP_WRITE_RE = /^\/(?:cf|coinflip)\s+\S+/i;

// GUIs de solo lectura: abrir el menú no modifica estado. Solo la forma
// desnuda (sin subcomando ni argumentos) está permitida; `/ah sell` y
// cualquier otro subcomando siguen pasando por el guard de escritura.
const READ_ONLY_GUI_CMDS = new Set(['ah', 'auction']);

function isReadOnlyGui(cmd) {
  const m = String(cmd).trim().match(/^\/([a-z0-9_]+)(?:\s+([\s\S]*))?$/i);
  if (!m) return false;
  if (!READ_ONLY_GUI_CMDS.has(m[1].toLowerCase())) return false;
  return !m[2] || !m[2].trim();
}

// Compara un sondeo con el comando objetivo de --click-window sin depender de
// la barra inicial ni de mayúsculas.
function sameCommand(a, b) {
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/^\/+/, '');
  const x = norm(a);
  const y = norm(b);
  return x === y || x.startsWith(`${y} `);
}

function checkWindow() {
  // La franja es obligatoria para conectar el bot; ping-only no la necesita.
  if (!PING_ONLY && (WINDOW_FROM == null || WINDOW_UNTIL == null)) {
    return 'falta --window-from/--window-until: sin franja autorizada el bot no se conecta (ping-only no la necesita)';
  }
  const now = Date.now();
  if (WINDOW_FROM != null && Number.isFinite(WINDOW_FROM) && now < WINDOW_FROM) {
    return `antes de la ventana autorizada (${new Date(WINDOW_FROM).toISOString()})`;
  }
  if (WINDOW_UNTIL != null && Number.isFinite(WINDOW_UNTIL) && now > WINDOW_UNTIL) {
    return `después de la ventana autorizada (${new Date(WINDOW_UNTIL).toISOString()})`;
  }
  return null;
}

// Las contraseñas de auth nunca deben quedar en el JSON ni en el informe.
// 2026-11-23: se enmascara TODO lo que sigue al verbo — antes solo se cubría
// el primer token y "/register pw pw" quedaba "/register **** pw" (la segunda
// copia de la contraseña viajaba en sentCommands y en el .md de report.js).
// También se cubre /log (alias de login de nLogin).
function maskSecrets(cmd) {
  return String(cmd).replace(/^(\/(?:register|reg|login|log|l)\s*).*$/i, '$1****');
}

let lastSentAt = 0;

// Único punto de salida de comandos: aplica read-only, tope, intervalo y
// deja registro auditable de lo enviado.
async function send(bot, cmd) {
  const label = maskSecrets(cmd);
  // La ventana se revalida en CADA envío: una corrida larga puede cruzar el
  // fin de la franja y seguir mandando comandos fuera de autorización.
  const winErr = checkWindow();
  if (winErr) {
    result.blockedCommands.push(`(fuera de ventana) ${label}`);
    console.error(`[!] FUERA DE VENTANA al enviar: ${winErr}. Abortando.`);
    if (!result.aborted) {
      result.aborted = { reason: `fuera de ventana: ${winErr}`, at: new Date().toISOString() };
    }
    try { bot.quit(); } catch { /* ya cerrado */ }
    return false;
  }
  // Los guards se testean sobre la forma normalizada (sin namespace).
  const norm = stripNamespace(cmd);
  if (READ_ONLY && COINFLIP_WRITE_RE.test(norm) && !COINFLIP_READONLY_RE.test(norm) && !COINFLIP_CREATE_BARE_RE.test(norm)) {
    result.blockedCommands.push(label);
    console.log(`[!] bloqueado por --read-only (coinflip): ${label}`);
    return false;
  }
  if (READ_ONLY && WRITE_CMD_RE.test(norm) && !isReadOnlyGui(norm)) {
    result.blockedCommands.push(label);
    console.log(`[!] bloqueado por --read-only: ${label}`);
    return false;
  }
  if (result.sentCommands.length >= MAX_COMMANDS) {
    result.blockedCommands.push(`(tope ${MAX_COMMANDS}) ${label}`);
    console.log(`[!] tope de ${MAX_COMMANDS} comandos alcanzado: ${label}`);
    return false;
  }
  const gap = lastSentAt ? MIN_INTERVAL - (Date.now() - lastSentAt) : 0;
  if (gap > 0) await sleep(gap);
  try {
    bot.chat(cmd);
  } catch (e) {
    result.errors.push(`send ${label}: ${e.message}`);
    return false;
  }
  lastSentAt = Date.now();
  result.sentCommands.push({ at: new Date().toISOString(), cmd: label });
  return true;
}

// ---------------------------------------------------------------- evidencia

// Inventario mínimo para comparar antes/después de un clic transaccional.
function snapshotInventory(bot) {
  const snap = { at: new Date().toISOString(), slots: [], held: null };
  try {
    snap.heldSlot = bot.quickBarSlot;
    const held = bot.heldItem;
    if (held) snap.held = { name: held.name, count: held.count };
    for (const item of bot.inventory.items()) {
      snap.slots.push({
        slot: item.slot,
        name: item.name,
        count: item.count,
        nameCustom: textOf(item.customName) || undefined,
      });
    }
  } catch (e) {
    snap.error = e.message;
  }
  return snap;
}

// Convierte "7,500.00" (formato es-AR) o "7,500" a número.
function parseMoneyString(raw) {
  const s = String(raw).trim().replace(/\s/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let normalized;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thousands = dec === '.' ? /,/g : /\./g;
    normalized = s.replace(thousands, '').replace(dec, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    // "7.500" o "7,500" son miles; "7.5" o "7,50" son decimales.
    normalized = parts.length > 1 && parts[parts.length - 1].length === 3
      ? s.split(sep).join('')
      : s.replace(sep, '.');
  } else {
    normalized = s;
  }
  const v = Number(normalized);
  return Number.isFinite(v) ? v : null;
}

// Lee el saldo con /money. Solo se usa cuando el clic es transaccional.
async function readBalance(bot) {
  let value = null;
  let raw = null;
  const handler = (msg, position) => {
    if (isActionbar(position)) return;
    const t = clean(msg && msg.toString ? msg.toString() : msg);
    // El servidor usa small caps: "ʙᴀɴᴄᴏ • ᴛɪᴇɴᴇꜱ 240$".
    const m =
      t.match(/(?:banco|ʙᴀɴᴄᴏ)[^\d-]*(-?[\d.,]+)\s*\$/i) ||
      t.match(/(?:tienes|ᴛɪᴇɴᴇꜱ)[^\d-]*(-?[\d.,]+)\s*\$/i) ||
      t.match(/Tienes\s+[^\d-]*(-?[\d.,]+)\s+Dineros/i);
    if (m) {
      raw = m[1];
      value = parseMoneyString(m[1]);
    }
  };
  bot.on('message', handler);
  const ok = await send(bot, '/money');
  await sleep(1400);
  bot.removeListener('message', handler);
  return { ok, value, raw };
}

// PII: los nombres de jugadores reales no van al informe.
const nameMap = new Map();

function registerName(name) {
  if (!REDACT || !name) return;
  if (name === USER) return;
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return;
  if (!nameMap.has(name)) nameMap.set(name, `[jugador-${nameMap.size + 1}]`);
}

function redactText(text) {
  if (!REDACT) return text;
  let out = String(text);
  for (const [name, alias] of nameMap) {
    out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), alias);
  }
  return out;
}

// Condición de parada del correo: lag anormal o impacto sobre el servidor.
let slowStreak = 0;
let activeBot = null;

function noteLatency(ms) {
  result.latencies.push(ms);
  if (!ABORT_LAG) return;
  if (ms >= ABORT_LAG) slowStreak++;
  else slowStreak = 0;
  if (slowStreak >= 3 && !result.aborted) {
    result.aborted = {
      reason: `latencia >= ${ABORT_LAG}ms en 3 mediciones seguidas`,
      at: new Date().toISOString(),
    };
    console.log(`[!] CONDICIÓN DE PARADA: ${result.aborted.reason}. Desconectando.`);
    try {
      if (activeBot) activeBot.quit();
    } catch {
      /* ya desconectado */
    }
  }
}

// ---------------------------------------------------------------- status ping

function pingOnce(withVersion) {
  return new Promise((resolve) => {
    const opts = { host: HOST, port: PORT };
    if (withVersion) opts.version = withVersion;
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ error: 'timeout' });
    }, 8000);
    try {
      mc.ping(opts, (err, res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(err ? { error: err.message } : res);
      });
    } catch (e) {
      clearTimeout(timer);
      resolve({ error: e.message });
    }
  });
}

async function pingServer() {
  // Primero sin versión forzada: así queda registrado el protocolo NATIVO que
  // anuncia el servidor, distinto del que usamos para conectar el cliente.
  const native = await pingOnce(undefined);
  result.statusNative = native && !native.error ? { version: native.version, players: native.players } : { error: native && native.error };
  if (!native || native.error) return VERSION ? await pingOnce(VERSION) : native;
  return native;
}

// ---------------------------------------------------------------- bot

// Resource pack: algunos backends (Towny, por ejemplo) lo exigen. mineflayer
// solo acepta automáticamente durante la fase de configuración; si llega ya en
// juego hay que responder o el servidor te deja afuera. La URL y el hash son
// intel: el pack revela el contenido custom del servidor.
function pickPackArgs(a, b) {
  const first = String(a);
  const second = String(b);
  return /^https?:\/\//i.test(first) ? { url: first, id: second } : { url: second, id: first };
}

async function fetchPack(url, index) {
  if (!url) return null;
  const crypto = require('crypto');
  const dir = path.join(__dirname, 'packs');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const tag = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
    const file = path.join(dir, `${index}-${tag}.zip`);
    fs.writeFileSync(file, buf);
    return {
      file,
      bytes: buf.length,
      sha1: crypto.createHash('sha1').update(buf).digest('hex'),
    };
  } catch (e) {
    return { error: e.message };
  }
}

const TRACE = Boolean(args.trace);
const PACKET_LOG = Boolean(args['packet-log']);
const switchEvents = [];
let backendJoins = 0;

// Secuencia de eventos de conexión. Sirve para saber si el cambio de backend
// llegó a completarse o murió en la fase de configuración, que es justo lo que
// el mensaje genérico de Velocity ("internal error") no dice.
function traceEvent(kind, detail) {
  const ev = {
    at: new Date().toISOString(),
    kind,
    detail: detail == null ? null : String(detail).slice(0, 300),
  };
  if (switchEvents.length < 500) switchEvents.push(ev);
  if (TRACE) console.log(`[trace] ${kind}${detail ? ': ' + String(detail).slice(0, 200) : ''}`);
}

const TRACE_PACKETS = new Set([
  'login',
  'disconnect',
  'kick_disconnect',
  'join_game',
  'respawn',
  'start_configuration',
  'finish_configuration',
  'select_known_packs',
  'registry_data',
  'tags',
  'code_of_conduct',
  'reset_chat',
  'cookie_request',
  'custom_report_details',
  'server_links',
  'add_resource_pack',
  'resource_pack_send',
  'remove_resource_pack',
  'game_state_change',
  'custom_payload',
  'system_chat',
]);

function attachTrace(bot) {
  const c = bot._client;
  c.on('state', (s) => traceEvent('state', s));
  if (PACKET_LOG) {
    // Diagnóstico: nombre de cada paquete recibido durante login/configuración.
    // En play se ignoran todos salvo la desconexión.
    c.on('packet', (data, meta) => {
      const name = (meta && meta.name) || '?';
      const state = c.state;
      if (state === 'play' && !/disconnect|kick|system_chat/.test(name)) return;
      if (result.packetLog.length >= 600) return;
      const rec = { at: new Date().toISOString(), state, name };
      result.packetLog.push(rec);
      if (TRACE) console.log(`[pkt] ${state} ${name}`);
    });
  }
  c.on('packet', (data, meta) => {
    const name = (meta && meta.name) || '?';
    if (!TRACE_PACKETS.has(name)) return;
    if (name === 'login') {
      backendJoins++;
      const dimension = data && (data.dimension || data.worldName || data.world);
      traceEvent('backend_login', `#${backendJoins} entityId=${data && data.entityId} dim=${JSON.stringify(dimension)}`);
      result.logins.push({
        at: new Date().toISOString(),
        entityId: data && data.entityId,
        dimension: dimension == null ? null : String(dimension),
      });
    } else if (name === 'disconnect' || name === 'kick_disconnect') {
      let reason = '(sin razón)';
      try {
        reason = JSON.stringify(data && data.reason).slice(0, 300);
      } catch {
        reason = String(data && data.reason);
      }
      traceEvent('disconnect', reason);
      result.lastDisconnect = reason;
    } else if (name === 'add_resource_pack' || name === 'resource_pack_send') {
      traceEvent('pack', (data && (data.url || data.uuid)) || '(pack)');
    } else if (name === 'respawn' || name === 'join_game') {
      traceEvent(name, data && (data.worldName || data.dimension));
    }
  });
}

const seenPacks = new Set();
let packGate = null;

// mineflayer acepta el pack solo, en el mismo tick en que llega. Un cliente
// real primero lo descarga y recién después responde. Para poder imitarlo (o
// rechazarlo de verdad) interceptamos esa respuesta y la retenemos.
function attachPackControl(bot) {
  if (!PACK_FIRST && !DECLINE_PACK && !(PACK_DELAY > 0) && !PACKET_LOG) return;
  const c = bot._client;
  const origWrite = c.write.bind(c);
  c.write = (name, params) => {
    if (PACKET_LOG) {
      const state = c.state;
      if (state !== 'play' || /resource_pack|finish_configuration|select_known_packs/.test(name)) {
        if (result.packetLog.length < 600) {
          result.packetLog.push({
            at: new Date().toISOString(),
            dir: 'out',
            state,
            name,
            result: name === 'resource_pack_receive' ? params && params.result : undefined,
          });
          if (TRACE) console.log(`[pkt] -> ${state} ${name}${name === 'resource_pack_receive' ? ' result=' + params.result : ''}`);
        }
      }
    }
    if (name === 'resource_pack_receive' && packGate && packGate.hold) {
      packGate.queue.push([name, params]);
      traceEvent('pack_gate', `respuesta retenida (result=${params && params.result})`);
      return true;
    }
    // Un cliente real responde ACCEPTED, descarga el pack y recién después
    // manda SUCCESSFULLY_LOADED (result=0). Enviarlo en el mismo tick que el
    // ACCEPTED hace que algunos backends no lo den por cargado.
    if (name === 'resource_pack_receive' && PACK_DELAY > 0 && params && params.result === 0) {
      traceEvent('pack_hold_loaded', `SUCCESSFULLY_LOADED se enviará en ${PACK_DELAY} ms`);
      setTimeout(() => {
        try {
          origWrite(name, params);
          traceEvent('pack_loaded_sent', `tras ${PACK_DELAY} ms`);
        } catch (e) {
          result.errors.push(`pack delay: ${e.message}`);
        }
      }, PACK_DELAY);
      return true;
    }
    return origWrite(name, params);
  };
}

// Congela el movimiento del cliente: descarta position/position_look/look/
// flying/player_input y apaga la física de mineflayer. Sin esto el backend
// 26.3 (vía ViaProxy) expulsa con "Invalid move player packet received".
// Solo afecta al cliente; no envía nada al servidor.
function attachFreeze(bot) {
  if (!FREEZE) return;
  bot.physicsEnabled = false;
  const c = bot._client;
  const origWrite = c.write.bind(c);
  c.write = (name, params) => {
    if (/^(position|position_look|look|flying|player_input)$/.test(name)) {
      result.droppedMoves++;
      if (result.droppedMoves === 1) traceEvent('freeze', 'se descartan paquetes de movimiento del cliente');
      return true;
    }
    return origWrite(name, params);
  };
  traceEvent('freeze_on', 'movimiento del cliente congelado');
}

async function attachResourcePack(bot) {
  bot.on('resourcePack', async (a, b) => {
    const { url, id } = pickPackArgs(a, b);
    const key = `${url}|${id}`;
    if (seenPacks.has(key)) return;
    seenPacks.add(key);

    const rec = { url, id, at: new Date().toISOString(), accepted: !DECLINE_PACK };
    result.resourcePacks.push(rec);
    // Retiene la respuesta automática de mineflayer hasta que decidamos.
    if (PACK_FIRST || DECLINE_PACK) packGate = { hold: true, queue: [] };

    if (DECLINE_PACK) {
      // Deja que mineflayer encole su aceptación automática y descártala.
      await sleep(50);
      const gate = packGate;
      packGate = null;
      const queued = gate ? gate.queue : [];
      // Algunos servidores mandan un hash como id y uuid-1345 LANZA con ids
      // no-UUID. Antes el throw caía dentro de este handler async →
      // unhandledRejection → el proceso moría y se perdía TODA la corrida
      // sin escribir la evidencia.
      let packUuid;
      try {
        packUuid = new (require('uuid-1345'))(id);
      } catch (e) {
        result.errors.push(`id de pack no es un UUID válido ("${String(id).slice(0, 80)}"): no se envía resource_pack_receive`);
        console.log(`[pack] id no-UUID (${url}); no se responde`);
        return;
      }
      console.log(`[pack] rechazando: ${url} (${queued.length} respuesta(s) automática(s) descartada(s))`);
      traceEvent('pack_declined', url);
      try {
        // Se responde DECLINED con el uuid del pack. No se usa
        // bot.denyResourcePack(): en versiones con uuid manda un segundo
        // paquete sin uuid y rompe la serialización.
        bot._client.write('resource_pack_receive', { uuid: packUuid, result: 1 });
      } catch (e) {
        result.errors.push(`denyResourcePack: ${e.message}`);
      }
      return;
    }

    if (PACK_FIRST) {
      console.log(`[pack] descargando antes de aceptar: ${url}`);
      const dl = await fetchPack(url, result.resourcePacks.length);
      if (dl && !dl.error) {
        rec.downloaded = dl;
        console.log(`[pack] ${dl.bytes} bytes listos, aceptando`);
      } else {
        rec.downloadError = (dl && dl.error) || 'desconocido';
        console.log(`[pack] falló la descarga (${rec.downloadError}), acepto igual`);
      }
      // Libera la respuesta automática que mineflayer quiso mandar al instante.
      // bot._client.write pasa por attachPackControl, que ya aplica PACK_DELAY
      // a SUCCESSFULLY_LOADED (result=0) exactamente una vez.
      const gate = packGate;
      packGate = null;
      if (gate && gate.queue.length) {
        for (const [n, p] of gate.queue) bot._client.write(n, p);
        traceEvent('pack_released', `${gate.queue.length} respuesta(s) tras la descarga`);
      } else if (bot._client && bot._client.state !== 'configuration') {
        try {
          bot.acceptResourcePack();
        } catch (e) {
          result.errors.push(`acceptResourcePack: ${e.message}`);
        }
      }
      return;
    }

    console.log(`[pack] aceptando: ${url}`);
    if (bot._client && bot._client.state !== 'configuration') {
      try {
        bot.acceptResourcePack();
      } catch (e) {
        result.errors.push(`acceptResourcePack: ${e.message}`);
      }
    }
  });
}

// Convierte un componente de chat (string, JSON o array) en texto plano.
function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('{') || s.startsWith('"') || s.startsWith('[')) {
      try {
        return textOf(JSON.parse(s));
      } catch {
        /* no era JSON */
      }
    }
    return clean(s);
  }
  if (Array.isArray(v)) return clean(v.map(textOf).filter(Boolean).join(' '));
  if (typeof v === 'object') {
    const parts = [];
    if (v.text != null) parts.push(String(v.text));
    if (v.translate != null && !parts.length) parts.push(String(v.translate));
    if (v.extra) parts.push(textOf(v.extra));
    if (v.with) parts.push(textOf(v.with));
    return clean(parts.filter(Boolean).join(' '));
  }
  return clean(String(v));
}

// Decodifica el formato NBT "anonymous" que usa minecraft-protocol en los
// componentes de item (custom_name, lore) a texto legible.
function nbtText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(nbtText).join('');
  if (typeof node !== 'object') return String(node);
  if (node.type && Object.prototype.hasOwnProperty.call(node, 'value')) {
    if (node.type === 'string') {
      return Array.isArray(node.value) ? node.value.join('') : String(node.value);
    }
    if (node.type === 'list') {
      const v = node.value;
      if (!v || !Array.isArray(v.value)) return '';
      return v.value.map(nbtText).join('');
    }
    if (node.type === 'compound') return nbtText(node.value);
    return '';
  }
  let s = '';
  if (node.text != null) s += typeof node.text === 'string' ? node.text : nbtText(node.text);
  if (node.translate != null && !s) s += typeof node.translate === 'string' ? node.translate : '';
  if (node.extra != null) s += nbtText(node.extra);
  if (node.with != null) s += nbtText(node.with);
  return s;
}

function compRaw(components, name) {
  for (const c of components || []) {
    if (c && (c.type || c.name) === name) return c.data;
  }
  return null;
}

function compText(components, name) {
  const v = compRaw(components, name);
  return v == null ? '' : nbtText(v).replace(/\s+/g, ' ').trim();
}

function compLore(components) {
  const v = compRaw(components, 'lore');
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => nbtText(x).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function attachWindows(bot) {
  // Una ventana se pulsa como máximo una vez por comando: al abrir una
  // categoría dentro de /shop, la ventana hija hereda el mismo `cmd` y no debe
  // volver a pulsarse el mismo slot.
  const clickedCmds = new Set();
  const chainState = new Map();
  const normCmd = (s) => String(s || '').trim().toLowerCase().replace(/^\/+/, '');
  const windowMatches = sameCommand;
  bot.on('windowOpen', (window) => {
    if (!window || !result.windows) return;
    if (result.windows.length >= MAX_WINDOWS) {
      try {
        bot.closeWindow(window);
      } catch {
        /* ya cerrada */
      }
      return;
    }
    const rec = {
      at: new Date().toISOString(),
      cmd: currentProbeName,
      title: textOf(window.title),
      type: window.type,
      slots: [],
    };
    for (const [slot, item] of Object.entries(window.slots || {})) {
      if (!item) continue;
      if (rec.slots.length >= 60) break;
      const cName = compText(item.components, 'custom_name');
      const cLore = compLore(item.components);
      rec.slots.push({
        slot: Number(slot),
        id: item.name,
        count: item.count,
        name: cName || textOf(item.customName) || item.displayName || item.name,
        lore: (cLore.length ? cLore : (item.customLore || []).map(textOf)).filter(Boolean).slice(0, 10),
        components: Array.isArray(item.components)
          ? item.components
              .map((c) => {
                if (!c) return null;
                const type = c.type || c.name || '?';
                let data = c.data;
                if (data && typeof data === 'object') {
                  try {
                    data = JSON.stringify(data);
                  } catch {
                    data = String(data);
                  }
                }
                return `${type}:${data == null ? '' : String(data).slice(0, 240)}`;
              })
              .filter(Boolean)
              .slice(0, 20)
          : undefined,
        nbtKeys: item.nbt ? Object.keys(item.nbt).slice(0, 15) : undefined,
      });
    }
    result.windows.push(rec);
    console.log(`[gui] ${rec.cmd || ''} "${rec.title}" (${rec.slots.length} ítems)`);
    // El número de veces que se envió este comando identifica la ventana raíz;
    // las ventanas hijas heredan el mismo `cmd` y avanzan la cadena de clics.
    const sentCount = result.sentCommands.filter((c) => sameCommand(c.cmd, rec.cmd)).length;
    const clickKey = `${normCmd(rec.cmd)}#${sentCount}`;
    let slotToClick = null;
    let chainStep = -1;
    if (CLICK_CHAIN.length) {
      chainStep = chainState.get(clickKey) || 0;
      if (chainStep < CLICK_CHAIN.length) slotToClick = CLICK_CHAIN[chainStep];
    } else {
      const slotIndex = Math.max(sentCount, 1) - 1;
      slotToClick = CLICK_SLOTS.length ? CLICK_SLOTS[slotIndex % CLICK_SLOTS.length] : null;
    }
    const clickable =
      slotToClick != null &&
      (CLICK_CHAIN.length ? true : !clickedCmds.has(clickKey)) &&
      (CLICK_WINDOW ? windowMatches(rec.cmd, CLICK_WINDOW) : normCmd(rec.cmd) === 'compass');
    const target = clickable ? rec.slots.find((s) => s.slot === slotToClick) : null;
    if (clickable && target) {
      // Clic explícito: en modo nav solo abre menús; en modo trade (con
      // --allow-writes) puede comprar/vender/reclamar. Nunca se pulsa sola.
      if (CLICK_CHAIN.length) chainState.set(clickKey, chainStep + 1);
      else clickedCmds.add(clickKey);
      rec.clickedSlot = slotToClick;
      rec.clickedKind = CLICK_KIND;
      setTimeout(async () => {
        try {
          const label = CLICK_KIND === 'trade' ? 'operación' : 'navegación';
          console.log(
            `[gui] clic de ${label} (${CLICK_BUTTON ? 'derecho' : 'izquierdo'}) en slot ${slotToClick} (${target.name}) de ${rec.cmd}`
          );
          traceEvent('gui_click', `${CLICK_KIND}/${CLICK_BUTTON ? 'right' : 'left'} slot ${slotToClick}: ${target.name} (${rec.cmd})`);
          // Un clic "nav" igual puede transaccionar según el plugin (el clic
          // izquierdo sobre un ítem de subasta suele comprar/pujar): en
          // read-only se vigila el saldo alrededor del PRIMER clic y se
          // aborta ante cualquier delta. La semántica la define el server.
          const guardBalance = READ_ONLY && CLICK_KIND === 'nav' && !navBalanceChecked;
          const before = guardBalance ? await readBalance(bot) : null;
          await bot.clickWindow(slotToClick, CLICK_BUTTON, 0);
          result.guiClicks.push({
            at: new Date().toISOString(),
            slot: slotToClick,
            name: target.name,
            window: rec.cmd,
            kind: CLICK_KIND,
            button: CLICK_BUTTON ? 'right' : 'left',
          });
          if (guardBalance) {
            navBalanceChecked = true;
            const after = await readBalance(bot);
            if (before && after && before.value != null && after.value != null && after.value !== before.value) {
              const msg = `clic de navegación cambió el saldo (${before.value}$ -> ${after.value}$): la ventana transacciona; abortando`;
              result.errors.push(msg);
              if (!result.aborted) result.aborted = { reason: msg, at: new Date().toISOString() };
              try { bot.quit(); } catch { /* ya cerrado */ }
            }
          }
        } catch (e) {
          result.errors.push(`gui click: ${e.message}`);
        }
      }, 800);
    } else if (clickable) {
      console.log(`[gui] ${rec.cmd}: sin ítem en el slot ${slotToClick}; no se pulsa nada`);
      setTimeout(() => {
        try {
          bot.closeWindow(window);
        } catch {
          /* ya cerrada */
        }
      }, 900);
    } else {
      // Sin clic: se cierra sin tocar ningún slot, solo se leyó el contenido.
      setTimeout(() => {
        try {
          bot.closeWindow(window);
        } catch {
          /* ya cerrada */
        }
      }, 900);
    }
  });
}

function attachCapture(bot) {
  bot._client.on('packet', (data, meta) => {
    const name = meta && meta.name;
    if (!name) return;
    try {
      switch (name) {
        case 'declare_commands': {
          const tree = parseCommandTree(data);
          if (tree) {
            for (const c of tree.topLevel) topLevel.add(c);
            literalCount = Math.max(literalCount, tree.all.length);
          }
          collectNamespaces(data, buckets.commands);
          break;
        }
        case 'declare_recipes':
          collectNamespaces(data, buckets.recipes);
          break;
        case 'registry_data':
          collectNamespaces(data, buckets.registries);
          break;
        case 'tags':
          collectNamespaces(data, buckets.tags);
          break;
        case 'custom_payload': {
          if (data && data.channel) {
            pluginChannels.add(data.channel);
            if (data.channel === 'minecraft:brand' && !result.brand) {
              result.brand = decodeBrand(data.data);
              if (result.brand) result.brands.push(result.brand);
            }
          }
          break;
        }
        case 'server_data':
          result.serverData = {
            motd: data && data.motd ? '(presente)' : null,
            hasIcon: Boolean(data && (data.icon || data.favicon)),
          };
          break;
        case 'login':
          if (!result.login) {
            result.login = {
              entityId: data && data.entityId,
              isHardcore: data && data.isHardcore,
              maxPlayers: data && data.maxPlayers,
              viewDistance: data && data.viewDistance,
            };
          }
          break;
        default:
          break;
      }
    } catch (e) {
      result.errors.push(`${name}: ${e.message}`);
    }
  });

  bot.on('message', (jsonMsg, position) => {
    const text = jsonMsg && jsonMsg.toString ? jsonMsg.toString() : String(jsonMsg);
    if (!text || !text.trim()) return;
    // El actionbar repite el mismo texto cada segundo: se guarda aparte para
    // no inundar el chat y perder los mensajes que sí importan.
    if (isActionbar(position)) {
      const t = text.trim().slice(0, 200);
      if (result.actionbars.length < 10 && !result.actionbars.includes(t)) result.actionbars.push(t);
      return;
    }
    if (chatSamples.length >= 200) return;
    chatSamples.push(text.trim().slice(0, 400));
  });
}

// Sondeo de comandos de solo lectura. No compra, no paga, no modifica nada:
// solo pregunta y guarda la respuesta del servidor.
const BASE_PROBES = ['/version', '/plugins', '/pl', '/about', '/tps', '/list'];
const TOWNY_PROBES = [
  ...BASE_PROBES,
  '/towny',
  '/towny version',
  '/towny prices',
  '/town',
  '/nation list',
  '/plot',
  '/res',
];
const EXTRA_PROBES = [
  ...(args['extra-probe']
    ? String(args['extra-probe'])
        .split(/[|;]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : []),
  ...readProbeFile(args['extra-probe-file']),
];
const PROBES = args['only-extra']
  ? EXTRA_PROBES
  : [...(PROFILE === 'towny' ? TOWNY_PROBES : BASE_PROBES), ...EXTRA_PROBES];

// El actionbar ("hay un huevo cerca") llega como mensaje y ahoga las
// respuestas reales de los comandos. Solo interesa el chat de verdad.
function isActionbar(position) {
  return position === 'game_info' || position === 2;
}

let currentProbeName = null;

async function probeCommands(bot) {
  const results = {};
  let current = null;
  const onMessage = (msg, position) => {
    if (!current) return;
    if (isActionbar(position)) return;
    const t = clean(msg && msg.toString ? msg.toString() : msg);
    if (!t) return;
    if (!results[current]) results[current] = [];
    if (results[current].length < 40) results[current].push(t);
  };
  bot.on('message', onMessage);
  for (const cmd of PROBES) {
    // Si la sesión murió (kick, abort, ventana vencida) no seguimos mandando
    // comandos a un cliente muerto: preservamos lo recolectado y salimos.
    if (result.aborted || !bot._client?.serializer?.writable) break;
    current = cmd;
    currentProbeName = cmd;
    results[cmd] = [];
    if (!(await send(bot, cmd))) {
      results[cmd].push('(bloqueado por el control de alcance)');
      result.probes = results;
      continue;
    }
    await sleep(PROBE_WAIT);
    // Si este sondeo abre una GUI que vamos a navegar, hay que esperar al clic
    // (800 ms) y a la ventana hija antes de pasar al siguiente comando.
    if (
      (CLICK_SLOTS.length > 0 || CLICK_CHAIN.length > 0) &&
      (CLICK_WINDOW ? sameCommand(cmd, CLICK_WINDOW) : cmd === 'compass')
    ) {
      await sleep(1400 + Math.max(0, CLICK_CHAIN.length - 1) * 900);
    }
    // Volcado incremental: si la sesión se corta (kick, detección, timeout)
    // el mapa comando→respuesta ya está en `result` y no se pierde.
    result.probes = results;
  }
  current = null;
  currentProbeName = null;
  bot.removeListener('message', onMessage);
  return results;
}

// Normaliza las distintas formas en que mineflayer puede devolver una
// sugerencia de tab-complete según la versión.
function normalizeTab(x) {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') return x.match || x.text || JSON.stringify(x);
  return String(x);
}

async function tabOnce(bot, query) {
  const t0 = Date.now();
  try {
    const tc = await withTimeout(bot.tabComplete(query), 3000, `tabComplete ${query}`);
    noteLatency(Date.now() - t0);
    return (tc || []).map(normalizeTab);
  } catch {
    noteLatency(Date.now() - t0);
    return [];
  }
}

// El servidor corta la respuesta en ~1000 sugerencias. Si se alcanza el
// tope, barremos por prefijo (a-z, 0-9) para recuperar el resto.
async function collectTabComplete(bot) {
  const all = new Set();
  const first = await tabOnce(bot, '/');
  for (const x of first) all.add(x);

  let swept = false;
  if (TAB_SWEEP && first.length >= 950) {
    swept = true;
    for (const ch of 'abcdefghijklmnopqrstuvwxyz0123456789_-') {
      const res = await tabOnce(bot, '/' + ch);
      for (const x of res) all.add(x);
      await sleep(100);
    }
  }

  return { list: [...all].sort(), swept, firstCount: first.length };
}

// AuthMe / nLogin: en servidores no premium el jugador entra congelado al
// lobby hasta registrarse o loguearse. Detectamos el aviso y, si nos pasaron
// credenciales, ejecutamos el comando correspondiente.
async function handleAuth(bot) {
  const seen = [];
  const onMessage = (m, position) => {
    if (isActionbar(position)) return;
    const t = clean(m && m.toString ? m.toString() : m);
    if (t && seen.length < 40) seen.push(t);
  };
  bot.on('message', onMessage);
  await sleep(2500);
  bot.removeListener('message', onMessage);

  const authRe = /register|registr|login|inicia sesi|autentic|contrase|password/i;
  result.authHints = seen.filter((t) => authRe.test(t)).slice(0, 10);
  if (result.authHints.length) console.log(`[auth] ${result.authHints[0]}`);

  const log = [];
  const captureFor = async (ms) => {
    const on = (m, position) => {
      if (isActionbar(position)) return;
      const t = clean(m && m.toString ? m.toString() : m);
      if (t && log.length < 30) log.push(t);
    };
    bot.on('message', on);
    await sleep(ms);
    bot.removeListener('message', on);
  };

  if (REGISTER) {
    console.log('[auth] enviando /register');
    await send(bot, `/register ${REGISTER} ${REGISTER}`);
    await captureFor(AUTH_WAIT);
  } else if (LOGIN) {
    console.log('[auth] enviando /login');
    await send(bot, `/login ${LOGIN}`);
    await captureFor(AUTH_WAIT);
  }

  result.authLog = log;
  if (REGISTER || LOGIN) {
    const ok = log.some((t) =>
      /registrad|registered|loguead|logged|autenticad|authenticated|sesi[oó]n iniciada|bienvenid|welcome/i.test(t)
    );
    const bad = log.some((t) => /incorrect|inv[aá]lid|already|ya est[aá]s/i.test(t));
    console.log(`[auth] ${ok ? 'posible éxito' : bad ? 'posible fallo' : 'sin confirmación clara'}`);
  }
}

// Proxy (BungeeCord/Velocity): el lobby no es el servidor de juego. Primero
// listamos los backends vía tab-complete (solo si se permiten sondeos) y, si
// nos indicaron uno, cambiamos.
// El lobby pide elegir el modo con el compás del slot 1. Abrirlo (sin hacer
// clic) muestra qué botón lleva a cada modo y con qué texto.
async function openCompass(bot) {
  if (!COMPASS) return;
  let slot = -1;
  for (let i = 0; i < 9; i++) {
    const item = bot.inventory && bot.inventory.slots ? bot.inventory.slots[36 + i] : null;
    if (item && /compass/.test(item.name)) {
      slot = i;
      break;
    }
  }
  if (slot < 0) {
    console.log('[compass] no hay compás en la hotbar; usando el slot 0 igual');
    slot = 0;
  }
  try {
    currentProbeName = 'compass';
    bot.setQuickBarSlot(slot);
    await sleep(500);
    bot.activateItem();
    console.log(`[compass] clic derecho en el slot ${slot}`);
    await sleep(2500);
  } catch (e) {
    result.errors.push(`compass: ${e.message}`);
  } finally {
    currentProbeName = null;
  }
}

async function switchServer(bot) {
  if (!PROBE && !SERVER_TARGET) return;

  if (!NO_TAB) {
    const opts = await tabOnce(bot, '/server ');
    result.proxyServers = [...new Set(opts)].filter((x) => x && !x.includes(' ')).sort();
    if (result.proxyServers.length) {
      console.log(`[proxy] backends visibles: ${result.proxyServers.slice(0, 15).join(', ')}`);
    }
  }
  if (!SERVER_TARGET) return;

  console.log(`[proxy] cambiando a "${SERVER_TARGET}" ...`);
  const joinsBefore = backendJoins;
  let waitedFor = 'desconocido';
  await new Promise((resolve) => {
    let done = false;
    let poll = null;
    let timeout = null;
    const finish = (why) => {
      if (done) return;
      done = true;
      waitedFor = why;
      if (poll) clearInterval(poll);
      if (timeout) clearTimeout(timeout);
      console.log(`[proxy] ${why}`);
      resolve();
    };
    bot.once('spawn', () => finish('spawn en el nuevo backend'));
    bot.once('respawn', () => finish('respawn en el nuevo backend'));
    bot.once('kicked', () => finish('kick durante el cambio'));
    bot.once('end', (r) => finish(`end durante el cambio: ${r}`));
    // Tras un transfer de Velocity el cliente no vuelve a emitir "spawn":
    // la señal fiable es el paquete login del backend destino, que ya cuenta
    // attachTrace en backendJoins.
    poll = setInterval(() => {
      if (backendJoins > joinsBefore) finish('login en el backend destino');
    }, 250);
    send(bot, `/server ${SERVER_TARGET}`);
    timeout = setTimeout(() => finish('timeout esperando el backend'), 25000);
  });
  if (!result.kicked && !result.lastDisconnect) await sleep(2500);

  const pos = bot.entity && bot.entity.position;
  result.serverSwitch = {
    to: SERVER_TARGET,
    ok: backendJoins > joinsBefore,
    waitedFor,
    loginsAfter: backendJoins - joinsBefore,
    position: pos ? { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) } : null,
    dimension: bot.game ? bot.game.dimension : null,
    lastDisconnect: result.lastDisconnect || null,
  };
}

async function runBot() {
  const bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username: USER,
    auth: AUTH,
    ...(VERSION ? { version: VERSION } : {}),
    hideErrors: false,
    checkTimeoutInterval: 90000,
    onMsaCode: (d) => {
      console.log('\n=== MICROSOFT: seguí estas instrucciones ===');
      console.log(d && d.message ? d.message : JSON.stringify(d, null, 2));
      console.log('===========================================\n');
    },
  });

  attachTrace(bot);
  attachCapture(bot);
  attachWindows(bot);
  attachPackControl(bot);
  attachFreeze(bot);
  attachResourcePack(bot);
  activeBot = bot;

  await new Promise((resolve) => {
    let finished = false;
    const finish = (why) => {
      if (finished) return;
      finished = true;
      console.log(`[..] fin de captura: ${why}`);
      resolve();
    };

    bot.once('spawn', async () => {
      console.log('[ok] spawn');
      if (REDACT) {
        for (const n of Object.keys(bot.players || {})) registerName(n);
        console.log(`[pii] ${nameMap.size} nombre(s) de jugador se redactarán en la salida`);
      }
      try {
        await handleAuth(bot);
        await switchServer(bot);
        await openCompass(bot);
      } catch (e) {
        result.errors.push(`auth/proxy: ${e.message}`);
      }
      if (result.kicked || result.lastDisconnect) {
        finish('kick durante el cambio de backend');
        return;
      }
      await sleep(WAIT);
      if (CLICK_KIND === 'trade') {
        result.inventoryBefore = snapshotInventory(bot);
        result.balanceBefore = await readBalance(bot);
        console.log(
          `[evidencia] saldo antes: ${result.balanceBefore.value} (${result.balanceBefore.raw}); ` +
            `${result.inventoryBefore.slots.length} tipos de ítem`
        );
      }
      if (NO_TAB) {
        console.log('[tab] omitido (--no-tab)');
      } else if (TAB_QUERIES.length) {
        result.tabQueries = {};
        for (const q of TAB_QUERIES) {
          result.tabQueries[q] = await tabOnce(bot, q);
          console.log(`[tab] ${q} -> ${result.tabQueries[q].slice(0, 20).join(', ')}`);
        }
      } else {
        try {
          const tc = await collectTabComplete(bot);
          result.tabComplete = tc.list;
          result.tabCompleteSwept = tc.swept;
          result.tabCompleteFirstCount = tc.firstCount;
        } catch (e) {
          result.errors.push(`tabComplete: ${e.message}`);
        }
      }
      if (PROBE) {
        try {
          probeResults = await probeCommands(bot);
        } catch (e) {
          result.errors.push(`probe: ${e.message}`);
        }
      }
      if (STAY > 0) {
        console.log(`[..] stay ${STAY} ms`);
        await sleep(STAY);
      }
      if (CLICK_KIND === 'trade') {
        result.inventoryAfter = snapshotInventory(bot);
        result.balanceAfter = await readBalance(bot);
        console.log(
          `[evidencia] saldo después: ${result.balanceAfter.value} (${result.balanceAfter.raw}); ` +
            `${result.inventoryAfter.slots.length} tipos de ítem`
        );
      }
      finish('captura completa');
    });

    bot.once('kicked', (reason) => {
      let text = '';
      try {
        text = typeof reason === 'string' ? reason : JSON.stringify(reason);
      } catch {
        text = String(reason);
      }
      result.kicked = text;
      result.errors.push(`kicked: ${text}`);
      finish('kicked');
    });
    bot.once('error', (err) => {
      result.errors.push(`error: ${err && err.message ? err.message : String(err)}`);
      finish('error');
    });
    bot.once('end', (reason) => finish(`end: ${reason}`));

    setTimeout(() => finish('timeout global'), WAIT + STAY + 150000);
  });

  try {
    bot.quit();
  } catch {
    /* el bot ya puede estar desconectado */
  }
}

// Descarga opcional del resource pack. Opt-in: es tráfico contra el CDN del
// cliente y el archivo puede pesar cientos de MB.
async function downloadPacks() {
  if (!DOWNLOAD_PACK || !result.resourcePacks.length) return;
  let i = 0;
  for (const p of result.resourcePacks) {
    i++;
    if (!p.url || p.downloaded) continue;
    const dl = await fetchPack(p.url, i);
    if (dl && !dl.error) {
      p.downloaded = dl;
      console.log(`[pack] descargado: ${dl.file} (${dl.bytes} bytes)`);
    } else {
      p.downloadError = (dl && dl.error) || 'desconocido';
    }
  }
}

// ---------------------------------------------------------------- resumen

const KNOWN_NS = {
  essentials: 'EssentialsX',
  essentialsx: 'EssentialsX',
  vault: 'Vault (API de economía)',
  cmi: 'CMI',
  shopgui: 'ShopGUIPlus',
  shopguiplus: 'ShopGUIPlus',
  economyshopgui: 'EconomyShopGUI',
  auctions: 'Auction House',
  auctionhouse: 'Auction House',
  zauctionhouse: 'zAuctionHouse',
  cratesplus: 'CratesPlus',
  excellentcrates: 'ExcellentCrates',
  crazycrates: 'CrazyCrates',
  luckperms: 'LuckPerms',
  worldguard: 'WorldGuard',
  worldedit: 'WorldEdit',
  placeholderapi: 'PlaceholderAPI',
  papi: 'PlaceholderAPI',
  viaversion: 'ViaVersion',
  viabackwards: 'ViaBackwards',
  bungeecord: 'BungeeCord',
  velocity: 'Velocity',
  geyser: 'GeyserMC',
  floodgate: 'Floodgate',
  citizens: 'Citizens',
  mythicmobs: 'MythicMobs',
  itemsadder: 'ItemsAdder',
  oraxen: 'Oraxen',
  nexo: 'Nexo',
  jobs: 'Jobs Reborn',
  mcmmo: 'mcMMO',
  coreprotect: 'CoreProtect',
  plan: 'Plan',
  spark: 'spark',
  deluxemenus: 'DeluxeMenus',
  protocollib: 'ProtocolLib',
  packetevents: 'PacketEvents',
  authme: 'AuthMe',
  nlogin: 'nLogin',
  litebans: 'LiteBans',
  libertybans: 'LibertyBans',
  towny: 'Towny',
  griefprevention: 'GriefPrevention',
  plotsquared: 'PlotSquared',
  residence: 'Residence',
  skinsrestorer: 'SkinsRestorer',
  tab: 'TAB',
  dynmap: 'Dynmap',
  bluemap: 'BlueMap',
};

function extractPlugins(lines) {
  const out = new Set();
  for (const raw of lines || []) {
    const l = clean(raw);
    if (!l) continue;
    const bullet = l.match(/^[-*]\s*(.+)$/);
    if (bullet) {
      out.add(bullet[1].trim());
      continue;
    }
    const named = l.match(/\b([A-Za-z0-9_.-]+)\s+v?(\d+\.\d+(?:\.\d+)?[A-Za-z0-9.\-+]*)/);
    if (named) out.add(`${named[1]} v${named[2]}`);
  }
  return [...out].sort();
}

function summarize() {
  const lines = [];
  lines.push('');
  lines.push('================ RESUMEN ================');
  lines.push(`Target:    ${HOST}:${PORT}`);
  lines.push(`Cuenta:    ${USER}${ACCOUNT ? ` (${ACCOUNT})` : '  [sin etiqueta --account]'}`);
  lines.push(`Modo:      ${READ_ONLY ? 'read-only (comandos que modifican estado bloqueados)' : 'ESCRITURA PERMITIDA'}`);
  if (WINDOW_FROM || WINDOW_UNTIL) {
    const f = WINDOW_FROM ? new Date(WINDOW_FROM).toISOString() : '(sin límite)';
    const u = WINDOW_UNTIL ? new Date(WINDOW_UNTIL).toISOString() : '(sin límite)';
    lines.push(`Ventana:   ${f} -> ${u}`);
  }
  lines.push(`Version:   ${result.version.name || '?'} (protocolo ${result.version.protocol ?? '?'})`);
  lines.push(`Brand:     ${result.brand || '(no informado)'}`);
  if (result.authHints.length) lines.push(`Auth:      ${result.authHints[0].slice(0, 140)}`);
  if (result.proxyServers.length) lines.push(`Backends:  ${result.proxyServers.slice(0, 12).join(', ')}`);
  if (result.serverSwitch) {
    const sw = result.serverSwitch;
    lines.push(
      `Backend:   ${sw.to} @ ${JSON.stringify(sw.position)} ${sw.ok ? '(login recibido)' : '(SIN login: el cambio falló)'}`
    );
    if (sw.lastDisconnect) lines.push(`Desconexión: ${String(sw.lastDisconnect).slice(0, 180)}`);
  }
  lines.push(`Comandos:  ${result.commands.topLevel.length} visibles / ${result.commands.literalCount} literales`);
  if (result.commands.literalCount > 0 && result.commands.literalCount < 60) {
    lines.push('           (árbol filtrado por permisos: solo ves lo que tu cuenta puede usar)');
  }
  lines.push(`Canales:   ${result.pluginChannels.length} de plugin`);
  if (result.resourcePacks.length) {
    lines.push(`Pack:      ${result.resourcePacks.map((p) => p.url || p.id || '?').join(', ')}`);
  }
  if (result.sentCommands.length) {
    lines.push(`Enviados:  ${result.sentCommands.length} comando(s), ${result.latencies.length} medición(es) de latencia`);
  }
  if (result.blockedCommands.length) {
    lines.push(`Bloqueados: ${result.blockedCommands.length} (ver JSON)`);
  }
  if (result.aborted) lines.push(`ABORTADO:  ${result.aborted.reason}`);
  lines.push('');

  const tcNs = result.tabCompleteNamespaces || {};
  const tcList = Object.keys(tcNs);
  if (tcList.length) {
    lines.push(`Namespaces revelados por tab-complete (${result.tabComplete.length} entradas${result.tabCompleteSwept ? ', barrido por prefijos' : ''}):`);
    for (const ns of tcList) {
      const label = KNOWN_NS[ns] ? `  <-- ${KNOWN_NS[ns]}` : '';
      lines.push(`  ${ns} (${tcNs[ns].length} comandos)${label}`);
    }
    lines.push('');
  }

  const nsList = Object.keys(result.commands.byNamespace);
  if (nsList.length) {
    lines.push('Namespaces de plugin en el árbol de comandos:');
    for (const ns of nsList) {
      const label = KNOWN_NS[ns] ? `  <-- ${KNOWN_NS[ns]}` : '';
      lines.push(`  ${ns} (${result.commands.byNamespace[ns].length} comandos)${label}`);
    }
    lines.push('');
  }

  const regNs = Object.keys(result.registries);
  if (regNs.length) {
    lines.push('Namespaces custom en registries (items/bloques/encantamientos):');
    for (const ns of regNs) {
      const label = KNOWN_NS[ns] ? `  <-- ${KNOWN_NS[ns]}` : '';
      lines.push(`  ${ns} (${result.registries[ns].length} entradas)${label}`);
    }
    lines.push('');
  }

  const recNs = Object.keys(result.recipes);
  if (recNs.length) {
    lines.push('Recetas custom:');
    for (const ns of recNs) lines.push(`  ${ns} (${result.recipes[ns].length})`);
    lines.push('');
  }

  if (result.pluginChannels.length) {
    lines.push('Canales de plugin (custom payload):');
    for (const ch of result.pluginChannels.sort()) lines.push(`  ${ch}`);
    lines.push('');
  }

  const verLines = result.probes['/version'] || [];
  if (verLines.length) {
    lines.push(`/version: ${verLines[0].slice(0, 200)}`);
    lines.push('');
  }

  const found = extractPlugins([...(result.probes['/plugins'] || []), ...(result.probes['/pl'] || [])]);
  if (found.length) {
    lines.push(`Plugins listados por /plugins (${found.length}):`);
    for (const p of found) lines.push(`  - ${p}`);
    lines.push('');
  }

  if (result.errors.length) {
    lines.push('Avisos/errores:');
    for (const e of result.errors) lines.push(`  - ${e}`);
    lines.push('');
  }

  lines.push(`JSON: ${OUT}`);
  lines.push('=========================================');
  return lines.join('\n');
}

// ---------------------------------------------------------------- main

// Red de seguridad: un unhandledRejection (p. ej. dentro de un handler async
// de mineflayer) mataba el proceso SIN escribir la evidencia. Se salva el
// result parcial antes de salir.
process.on('unhandledRejection', (e) => {
  console.error('UNHANDLED REJECTION:', e && e.stack ? e.stack : e);
  try {
    result.unhandledRejection = {
      at: new Date().toISOString(),
      message: String(e && e.message ? e.message : e).slice(0, 300),
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
    console.error(`[!] evidencia parcial salvada: ${OUT}`);
  } catch { /* nada más que hacer */ }
  process.exit(13);
});

(async () => {
  console.log(`[1/3] Status ping a ${HOST}:${PORT} ...`);
  const status = await pingServer();
  result.status = status && status.error ? { error: status.error } : status;
  if (status && !status.error) {
    result.version.name = status.version && status.version.name ? status.version.name : null;
    result.version.protocol = status.version && status.version.protocol != null ? status.version.protocol : null;
    console.log(`[ok] ${result.version.name} (protocolo ${result.version.protocol})`);
  } else {
    console.log(`[!] ping sin respuesta: ${status && status.error}`);
  }

  if (PING_ONLY) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
    console.log('[2/2] modo ping-only: solo información pública, no se conecta bot');
    console.log(summarize());
    process.exit(0);
  }

  const windowErr = checkWindow();
  if (windowErr) {
    result.errors.push(`fuera de ventana: ${windowErr}`);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
    console.error(`[!] FUERA DE VENTANA: ${windowErr}. No se conecta el bot.`);
    console.log(summarize());
    process.exit(3);
  }

  console.log(`[2/3] Conectando bot como "${USER}" (auth: ${AUTH}) ...`);
  await runBot();
  await downloadPacks();

  result.pluginChannels = [...pluginChannels].sort();
  result.commands.topLevel = [...topLevel].sort();
  result.commands.literalCount = literalCount;
  result.commands.byNamespace = mapToObj(buckets.commands);
  result.recipes = mapToObj(buckets.recipes);
  result.registries = mapToObj(buckets.registries);
  result.tags = mapToObj(buckets.tags);
  // Si la corrida se cortó a mitad del sondeo, probeResults nunca llegó a
  // asignarse: se conserva el volcado incremental en vez de pisarlo con {}.
  result.probes = Object.keys(probeResults || {}).length ? probeResults : result.probes;
  result.chat = chatSamples;
  result.switchEvents = switchEvents;
  result.tabCompleteNamespaces = groupNamespaces(result.tabComplete);

  if (REDACT) {
    const scrub = (v) => (typeof v === 'string' ? redactText(v) : v);
    result.chat = result.chat.map(scrub);
    result.authLog = (result.authLog || []).map(scrub);
    result.authHints = (result.authHints || []).map(scrub);
    result.tabComplete = (result.tabComplete || []).map(scrub);
    result.proxyServers = (result.proxyServers || []).map(scrub);
    for (const k of Object.keys(result.probes || {})) {
      result.probes[k] = (result.probes[k] || []).map(scrub);
    }
    // Ventanas y clics GUI: el lore de un /ah muestra nombres de vendedores
    // reales; actionbars y switchEvents también pueden llevar PII. Antes
    // --redact no tocaba ninguna de estas secciones.
    result.windows = (result.windows || []).map((w) => ({
      ...w,
      title: scrub(w.title),
      slots: (w.slots || []).map((s) => ({
        ...s,
        name: scrub(s.name),
        lore: (s.lore || []).map(scrub),
        components: Array.isArray(s.components) ? s.components.map(scrub) : s.components,
      })),
    }));
    result.guiClicks = (result.guiClicks || []).map((g) => ({ ...g, name: scrub(g.name) }));
    result.actionbars = (result.actionbars || []).map(scrub);
    result.switchEvents = (result.switchEvents || []).map((e) => ({ ...e, detail: scrub(e.detail) }));
    result.piiRedacted = nameMap.size;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('[3/3] ' + summarize());
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
