// version-probe.js — recolección read-only de versiones de plugins.
// Requiere --window-from/--window-until (ISO con offset) y cuenta autorizada
// (tools/lib/mc.js). Solo conecta con comandos informativos; cualquier otro
// comando exige --allow-writes (antes --commands aceptaba cualquier cosa,
// incluida una escritura con solo la guarda de ventana).
'use strict';

const path = require('path');
const {
  parseArgs, die, readSecret, requireWindow, requireAccount, sleep, connect, saveJson,
} = require('./lib/mc');

const args = parseArgs(process.argv.slice(2));
const account = requireAccount(args);
const windowScope = requireWindow(args);

const USER = account;
const LOGIN = readSecret(args.login, args['login-file']);
const OUT = String(args.out || path.join('out', `versions-${Date.now()}.json`));

// Whitelist de formas puramente informativas. Todo lo que no matchee podría
// modificar estado y se rechaza salvo --allow-writes.
const READONLY_CMD_RE =
  /^\/(?:towny\s+version|cf\s+info|coinflip\s+info|mypet(?:\s+info)?|brew(?:\s+info)?|chestshop\s+about|jobs(?:\s+info)?|limite|money|balance|bal)\s*$/i;

const COMMANDS = String(args.commands || '/towny version|/cf info|/mypet|/brew|/chestshop about|/jobs|/limite')
  .split(/[|;]/).map((s) => s.trim()).filter(Boolean);

const WRITE_MODE = args['allow-writes'] === true;
if (!WRITE_MODE) {
  const bad = COMMANDS.filter((cmd) => !READONLY_CMD_RE.test(cmd));
  if (bad.length) {
    die(`comandos fuera de la whitelist read-only: ${bad.join(' , ')}. Si hay autorización escrita para ellos, pasá --allow-writes. No se conecta.`, 4);
  }
}

const result = {
  tool: 'version-probe',
  meta: {
    generatedAt: new Date().toISOString(),
    account,
    window: windowScope,
    commands: COMMANDS,
    writeMode: WRITE_MODE,
  },
  responses: {},
  chat: [],
  events: [],
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

  for (const cmd of COMMANDS) {
    const before = chat.length;
    console.log(`[send] ${cmd}`);
    bot.chat(cmd);
    await sleep(1800);
    result.responses[cmd] = chat.slice(before);
  }

  result.chat = chat.slice(-300);
  try { bot.quit(); } catch { /* ya cerrado */ }
  await sleep(800);
  saveJson(OUT, result);
}

run().catch((e) => {
  console.error('[!] error:', e.message);
  result.errors.push(e.message);
  saveJson(OUT, result);
  process.exit(1);
});
