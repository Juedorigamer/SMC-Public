// towny-probe.js - diagnóstico de la fase de configuración de Towny.
//
// Solo lectura: entra al lobby, cambia a Towny y observa. No envía comandos de
// juego, no abre GUIs, no compra, no vende. Lo único que escribe es el
// handshake/login, el cambio de backend y la respuesta al resource pack.
//
// Uso:
//   node tools/towny-probe.js --username Auditor --login-file .secrets/auditor.txt \
//     --server towny --pack-mode accept --pack-delay 1500 --wait 50000 \
//     --window-from <ISO-con-offset> --window-until <ISO-con-offset> \
//     --out out/towny-diag-01.json
//
// Guardas: la ventana (--window-from/--window-until con zona horaria) y la
// cuenta son OBLIGATORIAS (opcionalmente restringidas con tools/lib/accounts.txt).
// Sin ellas el script no conecta.
//
// Modos de pack:
//   native          deja responder a mineflayer (3 y 0 en el mismo tick)
//   accept          responde 3 y, tras --pack-delay, 0
//   accept-instant  responde 3 y 0 juntos (pero bajo nuestro control)
//   accept-hash     agrega el hash del pack en la respuesta (si el esquema lo permite)
//   decline         responde 1 (rechazo)
//   none            no responde nada
//
// Extras:
//   --known-packs echo   responde select_known_packs con la misma lista del server
//   --brand              manda minecraft:brand en configuration
//   --stay-play <ms>     si entra al mundo, espera y sale (default 3000)

const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const UUID = require('uuid-1345');
const { requireAccount, requireWindow } = require('./lib/mc');

const args = process.argv.slice(2).reduce((acc, cur, i, arr) => {
  if (cur.startsWith('--')) {
    const key = cur.slice(2);
    const next = arr[i + 1];
    acc[key] = next && !next.startsWith('--') ? next : true;
  }
  return acc;
}, {});

const HOST = String(args.host || 'mc.ejemplo.com');
const PORT = Number(args.port || 25565);
// Cuenta y ventana OBLIGATORIAS: sin ellas el script no conecta.
const USER = requireAccount(args);
const windowScope = requireWindow(args);
const VERSION = String(args.version || '26.1');
const SERVER = String(args.server || 'towny');
const PACK_MODE = String(args['pack-mode'] || 'accept');
const PACK_DELAY = args['pack-delay'] != null ? Number(args['pack-delay']) : 1500;
const WAIT = args.wait != null ? Number(args.wait) : 50000;
const STAY_PLAY = args['stay-play'] != null ? Number(args['stay-play']) : 3000;
const KNOWN_PACKS = String(args['known-packs'] || 'empty');
const BRAND = Boolean(args.brand);
const FREEZE = args['no-freeze'] ? false : true;
const OUT = String(args.out || `out/towny-diag-${Date.now()}.json`);

// ------------------------------------------------------------------ alcance
if (!['native', 'accept', 'accept-instant', 'accept-hash', 'decline', 'none'].includes(PACK_MODE)) {
  console.error('[!] --pack-mode inválido');
  process.exit(2);
}
if (!['echo', 'empty'].includes(KNOWN_PACKS)) {
  console.error('[!] --known-packs debe ser echo o empty');
  process.exit(2);
}

function readSecret(argValue, file) {
  if (file) {
    try {
      return fs.readFileSync(String(file), 'utf8').split(/\r?\n/)[0].trim();
    } catch (e) {
      console.error(`[!] no se pudo leer ${file}: ${e.message}`);
      process.exit(2);
    }
  }
  return argValue ? String(argValue) : null;
}

const LOGIN = readSecret(args.login ? String(args.login) : null, args['login-file']);

const t0 = Date.now();
const rel = () => Date.now() - t0;

const result = {
  tool: 'towny-probe',
  meta: {
    generatedAt: new Date().toISOString(),
    target: { host: HOST, port: PORT },
    requestedVersion: VERSION,
    account: USER,
    auth: 'offline',
    readOnly: true,
    mode: 'config-diagnostic',
    packMode: PACK_MODE,
    packDelay: PACK_DELAY,
    knownPacks: KNOWN_PACKS,
    brand: BRAND,
    freeze: FREEZE,
    waitMs: WAIT,
    scope: {
      windowFrom: windowScope.from,
      windowUntil: windowScope.until,
    },
  },
  events: [],
  outbound: [],
  packets: [],
  chat: [],
  resourcePacks: [],
  selectKnownPacks: [],
  outcome: { enteredPlay: false },
  errors: [],
};

function ev(kind, detail) {
  const e = { t: rel(), kind, detail: detail == null ? null : String(detail).slice(0, 400) };
  result.events.push(e);
  console.log(`[${String(e.t).padStart(6)} ms] ${kind}${e.detail ? ': ' + e.detail : ''}`);
}

function err(where, e) {
  const msg = e && e.message ? e.message : String(e);
  result.errors.push({ t: rel(), where, message: msg.slice(0, 300) });
  console.error(`[!] ${where}: ${msg}`);
}

function safeJson(v, max = 600) {
  try {
    return JSON.stringify(v).slice(0, max);
  } catch {
    return String(v).slice(0, max);
  }
}

// --------------------------------------------------------------- conexión

const bot = mineflayer.createBot({
  host: HOST,
  port: PORT,
  username: USER,
  auth: 'offline',
  version: VERSION,
  hideErrors: false,
  checkTimeoutInterval: 120000,
});

const client = bot._client;
const origWrite = client.write.bind(client);
// Congelar movimiento: si el cliente manda position/look con NaN (o una
// posición que el backend 26.3 considera inválida) el servidor expulsa con
// "Invalid move player packet received". Para diagnóstico no necesitamos movernos.
bot.physicsEnabled = false;
let configStartedAt = null;
let finished = false;
let firstSpawn = true;
let transferSent = false;
let packUuid = null;
let receivedKnownPacks = null;
let packAnswered = false;
let droppedMoves = 0;

function done(code, why) {
  if (finished) return;
  finished = true;
  ev('finish', why);
  result.outcome.exitCode = code;
  result.outcome.elapsedMs = rel();
  result.outcome.droppedMoves = droppedMoves;
  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 1), 'utf8');
    console.log(`[ok] evidencia: ${OUT}`);
  } catch (e) {
    console.error(`[!] no se pudo escribir ${OUT}: ${e.message}`);
  }
  try {
    client.end('probe-done');
  } catch {}
  setTimeout(() => process.exit(code), 300);
}

// --------------------------------------------------- registro de paquetes

client.on('state', (s) => {
  ev('state', s);
  // Volver a configuration después de haber entrado a Towny = el proxy nos
  // devolvió a otro backend. Se registra y se corta la corrida.
  if (s === 'configuration' && result.outcome.enteredPlay && !result.outcome.bounced) {
    result.outcome.bounced = true;
    result.outcome.bouncedAt = new Date().toISOString();
    ev('bounce', 'nueva configuración tras entrar a Towny (posible fallback)');
    setTimeout(() => done(9, 'el proxy devolvió al jugador a otro backend'), 5000);
  }
  // Solo la configuración posterior al cambio de backend es la que interesa.
  if (s === 'configuration' && transferSent && configStartedAt == null) {
    configStartedAt = Date.now();
    setTimeout(() => {
      if (!finished && !result.outcome.finishConfigurationAt) {
        const secs = Math.round((Date.now() - configStartedAt) / 1000);
        ev('config_timeout', `${secs}s sin finish_configuration`);
        result.outcome.configStuck = true;
        done(5, 'la configuración no cerró');
      }
    }, WAIT);
  }
});

const KEY_PACKETS = new Set([
  'add_resource_pack',
  'remove_resource_pack',
  'resource_pack_send',
  'resource_pack_receive',
  'keep_alive',
  'finish_configuration',
  'select_known_packs',
  'custom_payload',
  'disconnect',
  'kick_disconnect',
  'login',
  'respawn',
  'registry_data',
  'tags',
  'ping',
]);

client.on('packet', (data, meta) => {
  const name = (meta && meta.name) || '?';
  if (!KEY_PACKETS.has(name)) return;
  const state = client.state;
  if (result.packets.length >= 500) return;
  const rec = { t: rel(), dir: 'in', state, name };
  if (name === 'add_resource_pack' || name === 'resource_pack_send') {
    rec.data = {
      uuid: data && data.uuid != null ? String(data.uuid) : undefined,
      url: data && data.url,
      hash: data && data.hash,
      forced: data && data.forced,
      prompt: data && data.prompt != null ? safeJson(data.prompt, 160) : undefined,
    };
    result.resourcePacks.push({ t: rel(), ...rec.data });
    ev('pack_in', `uuid=${rec.data.uuid} hash=${rec.data.hash}`);
  } else if (name === 'keep_alive') {
    rec.id = data && (data.keepAliveId != null ? data.keepAliveId : data.id);
    rec.data = undefined;
  } else if (name === 'select_known_packs') {
    rec.data = { packs: data && data.packs };
    receivedKnownPacks = data && data.packs;
    result.selectKnownPacks.push({ t: rel(), dir: 'in', packs: data && data.packs });
    ev('known_packs_in', safeJson(data && data.packs, 200));
  } else if (name === 'custom_payload') {
    rec.data = { channel: data && data.channel, bytes: data && data.data ? data.data.length : null };
  } else if (name === 'finish_configuration') {
    if (!transferSent) {
      ev('lobby_finish', 'finish_configuration del lobby (ignorado)');
    } else {
      result.outcome.finishConfigurationAt = new Date().toISOString();
      result.outcome.configDurationMs = configStartedAt ? Date.now() - configStartedAt : null;
      ev('finish_configuration_in', `${result.outcome.configDurationMs} ms desde el inicio de config`);
    }
  } else if (name === 'disconnect' || name === 'kick_disconnect') {
    rec.data = data && data.reason != null ? safeJson(data.reason, 400) : null;
    result.outcome.disconnect = rec.data;
  } else if (name === 'login') {
    rec.data = { entityId: data && data.entityId, dimension: data && data.dimension };
    if (transferSent) {
      result.outcome.playLogin = result.outcome.playLogin || [];
      result.outcome.playLogin.push({ t: rel(), entityId: data && data.entityId, dimension: String(data && data.dimension) });
      if (!result.outcome.enteredPlay) {
        result.outcome.enteredPlay = true;
        result.outcome.enteredPlayAt = new Date().toISOString();
        result.outcome.entityId = data && data.entityId;
        result.outcome.dimension = data && data.dimension != null ? String(data.dimension) : null;
        ev('towny_login', `entityId=${data && data.entityId} dim=${data && data.dimension}`);
        setTimeout(() => {
          if (!finished && !result.outcome.bounced) done(0, 'estable en Towny sin movimiento');
        }, STAY_PLAY + 4000);
      }
    }
  }
  result.packets.push(rec);
});

// --------------------------------------------------- control de escrituras

client.write = (name, params) => {
  // Se descartan los paquetes de movimiento mientras el cliente esté congelado.
  if (FREEZE && /^(position|position_look|look|flying|player_input)$/.test(name)) {
    droppedMoves++;
    if (droppedMoves === 1) ev('freeze', 'se descartan paquetes de movimiento del cliente');
    return true;
  }
  const state = client.state;
  if (state !== 'play' || /resource_pack|finish_configuration|select_known_packs|configuration_acknowledged/.test(name)) {
    if (result.outbound.length < 400) {
      const rec = { t: rel(), state, name };
      if (name === 'resource_pack_receive') {
        rec.result = params && params.result;
        rec.uuid = params && params.uuid != null ? String(params.uuid) : undefined;
        rec.hash = params && params.hash;
      }
      if (name === 'keep_alive') rec.id = params && (params.keepAliveId != null ? params.keepAliveId : params.id);
      if (name === 'select_known_packs') rec.packs = params && params.packs;
      result.outbound.push(rec);
    }
  }

  // Silenciar la respuesta automática de mineflayer: la manejamos nosotros.
  if (name === 'resource_pack_receive' && PACK_MODE !== 'native') {
    ev('pack_auto_suppressed', `result=${params && params.result}`);
    return true;
  }

  // Responder select_known_packs con la lista del servidor en vez de [].
  if (name === 'select_known_packs' && KNOWN_PACKS === 'echo' && receivedKnownPacks) {
    ev('known_packs_echo', `${receivedKnownPacks.length} packs`);
    return origWrite(name, { ...params, packs: receivedKnownPacks });
  }

  return origWrite(name, params);
};

// --------------------------------------------------- respuesta al pack

function sendPack(uuid, resultCode, extra) {
  const payload = { uuid, result: resultCode, ...(extra || {}) };
  try {
    origWrite('resource_pack_receive', payload);
    result.outbound.push({
      t: rel(),
      state: client.state,
      name: 'resource_pack_receive',
      result: resultCode,
      uuid: String(uuid),
      manual: true,
    });
    ev('pack_out', `result=${resultCode} uuid=${uuid}`);
  } catch (e) {
    err('pack_out', e);
  }
}

bot._client.on('add_resource_pack', (data) => {
  if (PACK_MODE === 'native' || packAnswered) return;
  packAnswered = true;
  try {
    packUuid = new UUID(data.uuid);
  } catch (e) {
    err('pack_uuid', e);
    return;
  }
  const hash = data.hash;
  if (PACK_MODE === 'none') {
    ev('pack_mode_none', 'no se responde el pack');
    return;
  }
  if (PACK_MODE === 'decline') {
    sendPack(packUuid, 1);
    return;
  }
  if (PACK_MODE === 'accept-instant') {
    sendPack(packUuid, 3);
    sendPack(packUuid, 0);
    return;
  }
  if (PACK_MODE === 'accept-hash') {
    const extra = hash != null ? { hash } : {};
    sendPack(packUuid, 3, extra);
    setTimeout(() => sendPack(packUuid, 0, extra), Math.max(0, PACK_DELAY));
    return;
  }
  // accept
  sendPack(packUuid, 3);
  setTimeout(() => sendPack(packUuid, 0), Math.max(0, PACK_DELAY));
});

// --------------------------------------------------- marca opcional

client.on('state', (s) => {
  if (s !== 'configuration' || !BRAND) return;
  const payload = Buffer.concat([Buffer.from([7]), Buffer.from('vanilla', 'utf8')]);
  try {
    origWrite('custom_payload', { channel: 'minecraft:brand', data: payload });
    ev('brand_out', 'minecraft:brand=vanilla');
  } catch (e) {
    err('brand', e);
  }
});

// --------------------------------------------------------------- ciclo

// Todo el chat que el cliente pueda ver (lobby y Towny). Es la única forma de
// saber por qué el proxy devuelve al jugador al lobby.
bot.on('message', (msg, position) => {
  let text = '';
  try {
    text = msg && msg.toString ? msg.toString() : String(msg);
  } catch {
    text = String(msg);
  }
  if (!text) return;
  if (result.chat.length < 200) {
    result.chat.push({ t: rel(), position: String(position), text: text.slice(0, 400) });
  }
  console.log(`[chat] ${text.slice(0, 200)}`);
});

bot.once('spawn', async () => {
  ev('spawn', 'primer backend');
  if (!LOGIN) {
    ev('login', 'sin contraseña configurada; se asume cuenta autenticada');
  } else {
    bot.chat(`/login ${LOGIN}`);
    ev('login', '/login ****');
  }
  await new Promise((r) => setTimeout(r, 3000));
  if (firstSpawn && !transferSent) {
    transferSent = true;
    firstSpawn = false;
    ev('transfer', `/server ${SERVER}`);
    bot.chat(`/server ${SERVER}`);
  }
});

// Segundo spawn = ya estamos en play del backend destino.
bot.on('spawn', () => {
  if (!transferSent) return;
  if (result.outcome.enteredPlay) return;
  result.outcome.enteredPlay = true;
  const pos = bot.entity && bot.entity.position;
  result.outcome.position = pos ? { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) } : null;
  result.outcome.dimension = bot.game ? bot.game.dimension : null;
  result.outcome.gameMode = bot.game ? bot.game.gameMode : null;
  ev('play_ready', `dim=${result.outcome.dimension} pos=${safeJson(result.outcome.position)}`);
  setTimeout(() => done(0, 'entró al mundo de Towny'), STAY_PLAY);
});

bot.on('kicked', (reason) => {
  const text = safeJson(reason, 400);
  result.outcome.kicked = text;
  ev('kicked', text);
  done(6, 'expulsado');
});

bot.on('error', (e) => err('bot', e));
bot.on('end', (reason) => {
  result.outcome.end = reason;
  ev('end', reason);
  if (!finished) done(result.outcome.enteredPlay ? 0 : 7, `conexión terminada: ${reason}`);
});

// Si el proxy corta sin kick explícito.
setTimeout(() => {
  if (!finished) done(result.outcome.enteredPlay ? 0 : 8, 'tiempo total agotado');
}, WAIT + 40000);
