#!/usr/bin/env node
'use strict';

/**
 * report.js — convierte un JSON de SMC en un informe Markdown.
 *
 *   node report.js                     (usa el JSON más reciente de out/)
 *   node report.js out/recon-x.json
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');

const KNOWN_NS = {
  essentials: 'EssentialsX', essentialsx: 'EssentialsX', vault: 'Vault',
  cmi: 'CMI', shopgui: 'ShopGUIPlus', shopguiplus: 'ShopGUIPlus',
  economyshopgui: 'EconomyShopGUI', auctions: 'Auction House',
  auctionhouse: 'Auction House', zauctionhouse: 'zAuctionHouse',
  cratesplus: 'CratesPlus', excellentcrates: 'ExcellentCrates',
  crazycrates: 'CrazyCrates', luckperms: 'LuckPerms',
  worldguard: 'WorldGuard', worldedit: 'WorldEdit',
  placeholderapi: 'PlaceholderAPI', papi: 'PlaceholderAPI',
  viaversion: 'ViaVersion', viabackwards: 'ViaBackwards',
  bungeecord: 'BungeeCord', velocity: 'Velocity', geyser: 'GeyserMC',
  floodgate: 'Floodgate', citizens: 'Citizens', mythicmobs: 'MythicMobs',
  itemsadder: 'ItemsAdder', oraxen: 'Oraxen', nexo: 'Nexo',
  jobs: 'Jobs Reborn', mcmmo: 'mcMMO', coreprotect: 'CoreProtect',
  plan: 'Plan', spark: 'spark', deluxemenus: 'DeluxeMenus',
  protocollib: 'ProtocolLib', packetevents: 'PacketEvents',
  authme: 'AuthMe', nlogin: 'nLogin', litebans: 'LiteBans',
  libertybans: 'LibertyBans', towny: 'Towny', townychat: 'TownyChat',
  griefprevention: 'GriefPrevention', plotsquared: 'PlotSquared',
  residence: 'Residence', skinsrestorer: 'SkinsRestorer', tab: 'TAB',
  dynmap: 'Dynmap', bluemap: 'BlueMap', chestshop: 'ChestShop',
  multiverse: 'Multiverse', worldguardextraflags: 'WG Extra Flags',
  libsdisguises: 'LibsDisguises', decentholograms: 'DecentHolograms',
  // Economía / progresión observadas en el backend Skyblock
  iridiumskyblock: 'IridiumSkyblock', eco: 'Eco (suite)', ecoshop: 'EcoShop',
  ecoitems: 'EcoItems', ecocrates: 'EcoCrates', ecoenchants: 'EcoEnchants',
  ecoarmor: 'EcoArmor', ecopets: 'EcoPets', ecomobs: 'EcoMobs', ecobits: 'EcoBits',
  zshop: 'zShop', zmenu: 'zMenu', playerkits2: 'PlayerKits2', rosestacker: 'RoseStacker',
  customcrafting: 'CustomCrafting', axshulkers: 'AxShulkers', axminions: 'AxMinions',
  axinventoryrestore: 'AxInventoryRestore', huskhomes: 'HuskHomes',
  auroracollections: 'AuroraCollections', auroraquests: 'AuroraQuests',
  pyrofishingpro: 'PyroFishingPro', pyrofarming: 'PyroFarming', pyromining: 'PyroMining',
  auraskills: 'AuraSkills', talismans: 'Talismans', reforges: 'Reforges',
  votingplugin: 'VotingPlugin', tebex: 'Tebex', libreforge: 'LibreForge',
  modelengine: 'ModelEngine', spawnershop: 'SpawnerShop', spawnermeta: 'SpawnerMeta',
  stattrackers: 'StatTrackers', smartitemsort: 'SmartItemSort', itemedit: 'ItemEdit',
  itemtag: 'ItemTag', servervariables: 'ServerVariables', wolfyutils: 'WolfyUtilities',
  teakstweaks: 'TeaksTweaks', nightcore: 'nightcore', kite: 'Kite',
  carbonchat: 'CarbonChat', fancyholograms: 'FancyHolograms', fancynpcs: 'FancyNpcs',
  prism: 'Prism', voicechat: 'Simple Voice Chat', rankup: 'Rankup',
  executableblocks: 'ExecutableBlocks', executableitems: 'ExecutableItems',
  conditionalevents: 'ConditionalEvents', farmcontrol: 'FarmControl',
  announcerplus: 'AnnouncerPlus', ajleaderboards: 'ajLeaderboards',
  interactivechat: 'InteractiveChat', freedomchat: 'FreedomChat',
  autoupdategeyser: 'AutoUpdateGeyser', sunlight: 'SunLight', voidgen: 'VoidGen',
};

function pluginName(ns) {
  if (KNOWN_NS[ns]) return KNOWN_NS[ns];
  // Prefijos cortos y desconocidos suelen ser del plugin propio del server.
  return '—';
}

function latestJson() {
  if (!fs.existsSync(OUT_DIR)) return null;
  try {
    const files = fs
      .readdirSync(OUT_DIR)
      // Solo salidas de recon (recon-*/gui-*): out/ también tiene JSONs de
      // las tools de prueba que no sirven para generar un informe.
      .filter((f) => f.endsWith('.json') && /^(recon|gui)-/.test(f))
      .map((f) => {
        try {
          return { f, t: fs.statSync(path.join(OUT_DIR, f)).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((x) => x && Number.isFinite(x.t))
      .sort((a, b) => b.t - a.t);
    return files.length ? path.join(OUT_DIR, files[0].f) : null;
  } catch {
    return null;
  }
}

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const tag = String(flagValue('--tag') || '').replace(/[^a-z0-9._-]/gi, '');
const valueIdx = new Set();
for (const name of ['--tag', '--evidence']) {
  const i = argv.indexOf(name);
  if (i >= 0) valueIdx.add(i + 1);
}
const inputArg = argv.find((a, i) => !a.startsWith('--') && !valueIdx.has(i));
const input = inputArg ? path.resolve(inputArg) : latestJson();
if (!input || !fs.existsSync(input)) {
  console.error('No encontré un JSON. Pasá la ruta: node report.js out/recon-....json');
  process.exit(1);
}

let j;
try {
  // El BOM (PowerShell Set-Content -Encoding UTF8) rompía JSON.parse y el
  // crashe no decía qué archivo ni por qué.
  j = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
  console.error(`[!] ${input} no es JSON válido: ${e.message}`);
  process.exit(2);
}

// Evidencia adicional para la matriz de versiones: mismo protocolo de prueba
// (o distinto) en otras corridas. Uso: --evidence a.json,b.json
const evidenceFiles = String(flagValue('--evidence') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function analyzeConfigPhase(rec) {
  const inc = (rec.packetLog || []).filter((p) => p.dir !== 'out');
  const idx = inc.map((p) => p.name).lastIndexOf('add_resource_pack');
  const after = idx >= 0 ? inc.slice(idx) : [];
  const finish = after.some((p) => p.name === 'finish_configuration');
  const kick = after.find((p) => /disconnect|kick/.test(p.name));
  const t0 = after.length ? new Date(after[0].at).getTime() : null;
  return {
    hasPack: idx >= 0,
    finish,
    keepAlives: after.filter((p) => p.name === 'keep_alive').length,
    kickAfter: kick && t0 ? Math.round((new Date(kick.at).getTime() - t0) / 1000) : null,
    loggedIn: Boolean(rec.login && rec.login.entityId),
  };
}

function modePlayers(rec, modeRe) {
  for (const w of rec.windows || []) {
    for (const s of w.slots || []) {
      if (!modeRe.test(s.name || '')) continue;
      const line = (s.lore || []).find((l) => /^jugadores/i.test(l));
      if (line) return line.replace(/^jugadores\s*:?\s*/i, '').trim();
    }
  }
  return null;
}
const target = (j.meta && j.meta.target) || {};
const host = target.host || '?';
const port = target.port || '?';

const rows = [];
const add = (s = '') => rows.push(s);

function table(headers, body) {
  add(`| ${headers.join(' | ')} |`);
  add(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const r of body) add(`| ${r.join(' | ')} |`);
  add();
}

function listBlock(items, limit = 60) {
  if (!items || !items.length) {
    add('_Sin datos._');
    add();
    return;
  }
  const shown = items.slice(0, limit);
  add('```');
  for (const it of shown) add(String(it));
  if (items.length > limit) add(`... (+${items.length - limit} más)`);
  add('```');
  add();
}

add(`# Informe de reconocimiento — ${host}:${port}`);
add();
add(`- **Fecha:** ${(j.meta && j.meta.generatedAt) || '?'}`);
add(`- **Herramienta:** ${(j.meta && j.meta.tool) || 'SMC'}`);
add(`- **Perfil:** ${(j.meta && j.meta.profile) || 'generic'}`);
add(`- **Versión:** ${(j.version && j.version.name) || '?'} (protocolo ${(j.version && j.version.protocol) ?? '?'})`);
const nativeProto = j.statusNative && j.statusNative.version && j.statusNative.version.protocol;
if (nativeProto && j.version && j.version.protocol && nativeProto !== j.version.protocol) {
  add(`- **Protocolo nativo del servidor:** ${nativeProto} (la sesión se abrió con ${j.version.protocol} por compatibilidad del cliente; ViaVersion hace la traducción)`);
}
add(`- **Software:** ${j.brand || 'no informado'}`);
add(`- **Modo:** ${(j.meta && j.meta.pingOnly) ? 'solo ping público (sin bot)' : 'reconocimiento con bot'}`);
const sc = (j.meta && j.meta.scope) || {};
if (sc.account) add(`- **Cuenta exenta:** ${sc.account} (usuario ${sc.username})`);
if (sc.windowFrom || sc.windowUntil) {
  add(`- **Ventana autorizada:** ${sc.windowFrom || '—'} → ${sc.windowUntil || '—'}`);
}
add(`- **Escritura:** ${sc.readOnly === false ? '⚠️ PERMITIDA' : 'solo lectura (comandos que modifican estado bloqueados)'}`);
add(`- **Límites:** ${sc.maxCommands ?? '—'} comandos, intervalo mínimo ${sc.minIntervalMs ?? '—'} ms`);
add();

add('## 1. Resumen');
add();
const ns = j.tabCompleteNamespaces || {};
const nsKeys = Object.keys(ns);
const pluginCount = nsKeys.length + Object.keys(j.registries || {}).length;
add(`- Namespaces de plugin detectados: **${nsKeys.length}**`);
add(`- Entradas de tab-complete: **${(j.tabComplete || []).length}**`);
add(`- Canales de plugin: **${(j.pluginChannels || []).length}**`);
add(`- Comandos visibles en el árbol: **${(j.commands && j.commands.topLevel ? j.commands.topLevel.length : 0)}**`);
if (pluginCount === 0 && !(j.probes && j.probes['/plugins'])) {
  add('- ⚠️ No se identificaron plugins. Puede ser un servidor limpio, un filtro de tab-complete o falta de permisos.');
}
add();

add('## 2. Plugins identificados');
add();
if (nsKeys.length) {
  add('### Por namespace de comandos (tab-complete)');
  add();
  table(
    ['Namespace', 'Plugin probable', 'Comandos'],
    nsKeys.map((k) => [k, pluginName(k), String((ns[k] || []).length)])
  );
} else {
  add('_Sin namespaces de plugin en tab-complete._');
  add();
}

const regKeys = Object.keys(j.registries || {});
if (regKeys.length) {
  add('### Por registries (items/bloques/encantamientos custom)');
  add();
  table(
    ['Namespace', 'Plugin probable', 'Entradas'],
    regKeys.map((k) => [k, pluginName(k), String((j.registries[k] || []).length)])
  );
}

// Segunda fuente: el árbol de comandos sí llega antes de autenticarse, y en
// este servidor fue más revelador que el tab-complete (que no respondió).
const CMD_PLUGIN = {
  nlogin: 'nLogin',
  register: 'nLogin',
  reg: 'nLogin',
  login: 'nLogin',
  l: 'nLogin',
  log: 'nLogin',
  changepass: 'nLogin',
  changepassword: 'nLogin',
  premium: 'nLogin',
  cracked: 'nLogin',
  offline: 'nLogin',
  recover: 'nLogin',
  skin: 'SkinsRestorer / nLogin (ambiguo)',
  skins: 'SkinsRestorer / nLogin (ambiguo)',
  lpv: 'LuckPerms (Velocity)',
  luckpermsvelocity: 'LuckPerms (Velocity)',
  geyser: 'GeyserMC',
  ultracosmetics: 'UltraCosmetics',
  store: 'Plugin de tienda (Tebex/Buycraft)',
  discord: 'DiscordSRV',
  server: 'Velocity (proxy)',
  'velocity:callback': 'Velocity (proxy)',
  bedrockgen_ex: 'custom (generador Bedrock)',
  ajp: 'no identificado (ajp)',
};

const cmds = (j.commands && j.commands.topLevel) || [];
const inferred = new Map();
for (const c of cmds) {
  const p = CMD_PLUGIN[c];
  if (!p) continue;
  if (!inferred.has(p)) inferred.set(p, []);
  inferred.get(p).push(c);
}
if (inferred.size) {
  add('### Inferidos del árbol de comandos (`INFERRED`)');
  add();
  table(
    ['Plugin probable', 'Comandos que lo delatan'],
    [...inferred.entries()].map(([p, list]) => [p, list.map((c) => `\`${c}\``).join(', ')])
  );
  add('_Inferencia por nombre de comando: no confirma la versión ni que el plugin esté activo. Un comando puede venir de otro plugin._');
  add();
}

const ch = j.pluginChannels || [];
if (ch.length) {
  add('### Canales de plugin');
  add();
  listBlock(ch, 80);
}

add('## 3. Respuestas de sondeo');
add();
const probes = j.probes || {};
const probeKeys = Object.keys(probes);
if (!probeKeys.length) {
  add('_No se ejecutaron sondeos._');
  add();
} else {
  for (const k of probeKeys) {
    add(`### \`${k}\``);
    add();
    const lines = (probes[k] || []).filter(Boolean);
    if (!lines.length) add('_Sin respuesta._');
    else {
      add('```');
      for (const l of lines.slice(0, 25)) add(String(l).slice(0, 300));
      add('```');
    }
    add();
  }
}

add('## 4. Autenticación y proxy');
add();
const authHints = j.authHints || [];
const proxy = j.proxyServers || [];
const authCmds = cmds.filter((c) => /^(register|reg|login|l|log|changepass|changepassword|premium|cracked|offline|recover|nlogin)$/.test(c));
const isProxy = cmds.includes('server') || cmds.includes('velocity:callback') || (j.pluginChannels || []).includes('vv:server_details');

if (!authHints.length && !proxy.length && !j.serverSwitch && !authCmds.length && !isProxy) {
  add('_No se detectó plugin de autenticación ni proxy._');
} else {
  if (isProxy) add(`- **Proxy:** detectado (comandos \`/server\` y canal \`vv:server_details\` de Velocity)`);
  if (authCmds.length) add(`- **Auth:** ${authCmds.map((c) => `\`/${c}\``).join(', ')} → familia nLogin (AuthMe expone \`/authme\`)`);
  if (authHints.length) add(`- Aviso de auth: ${authHints[0].slice(0, 220)}`);
  if (proxy.length) add(`- Backends visibles: ${proxy.join(', ')}`);
  if (j.serverSwitch) add(`- Backend usado: ${j.serverSwitch.to} (${JSON.stringify(j.serverSwitch.position)})`);
  const clicks = j.guiClicks || [];
  if (clicks.length) {
    add(`- Ingreso por menú: slot ${clicks.map((c) => `${c.slot} (${c.name})`).join(', ')} — el botón de modo del compás, no un comando \`/server\`.`);
  }
  if ((j.authLog || []).length) add(`- Última respuesta de auth: ${j.authLog.slice(-1)[0].slice(0, 220)}`);
  if (authCmds.length && !(j.authLog || []).length && !(j.login && j.login.entityId)) {
    add('- _No se envió `/register` ni `/login`: la sesión quedó sin autenticar a propósito._');
  }
}
add();

const packs = j.resourcePacks || [];
if (packs.length) {
  add('### Resource pack');
  add();
  table(
    ['URL', 'ID / hash', 'Aceptado', 'Descargado'],
    packs.map((p) => [
      p.url ? `\`${p.url}\`` : '—',
      p.id ? `\`${p.id}\`` : '—',
      p.accepted ? 'sí' : 'no',
      p.downloaded ? `${p.downloaded.bytes} B, sha1 \`${p.downloaded.sha1.slice(0, 12)}…\`` : p.downloadError || 'no',
    ])
  );
  add('_El pack revela el contenido custom del servidor (texturas de ítems, GUI de tiendas, crates). Sus namespaces suelen coincidir con los IDs de los ítems, que es donde se buscan fallas de duplicación._');
  add();
}

add('### Selector de modos (menú del compás)');
add();
const windows = j.windows || [];
const compass = windows.find((w) => w.cmd === 'compass') || windows.find((w) => (w.slots || []).some((s) => /skyblock|towny/i.test(s.name || '')));
if (!compass) {
  add('_No se capturó el menú del compás en esta corrida._');
  add();
} else {
  const modes = (compass.slots || []).filter((s) => /skyblock|towny/i.test(s.name || ''));
  if (modes.length) {
    table(
      ['Slot', 'Ítem', 'Modo', 'Versión', 'Jugadores', 'Acción'],
      modes.map((s) => {
        const lore = s.lore || [];
        const ver = (lore.find((l) => /^version/i.test(l)) || '').replace(/^version\s*:?\s*/i, '') || '—';
        const jug = (lore.find((l) => /^jugadores/i.test(l)) || '').replace(/^jugadores\s*:?\s*/i, '') || '—';
        const acc = (lore.find((l) => /▶|clic|ᴄʟɪᴄ/i.test(l)) || '').replace(/^▶\s*/, '') || '—';
        return [String(s.slot), s.id, s.name, ver, jug, acc];
      })
    );
    add('_El menú se leyó abriéndolo con clic derecho. Solo se pulsa un slot si se usó `--click-slot` explícitamente; no se mueve, compra ni reclama ningún ítem._');
    add();
  } else {
    add('_El menú se abrió, pero no se identificaron los botones de modo por nombre._');
    add();
  }
}

const otherWindows = windows.filter((w) => w !== compass);
if (otherWindows.length) {
  add('### Otras ventanas capturadas');
  add();
  for (const w of otherWindows) {
    const items = (w.slots || []).filter((s) => s.name !== s.id || (s.lore || []).length);
    add(`#### \`${w.cmd || '?'}\` — ${w.type} (${(w.slots || []).length} slots)`);
    add();
    if (!items.length) {
      add('_Sin ítems con nombre o lore._');
      add();
      continue;
    }
    table(
      ['Slot', 'Ítem', 'Nombre', 'Lore'],
      items.slice(0, 25).map((s) => [
        String(s.slot),
        s.id,
        s.name,
        (s.lore || []).join(' / ').slice(0, 220),
      ])
    );
  }
  add('_Las ventanas se abrieron y cerraron sin pulsar ningún slot: no se compró, vendió ni reclamó nada._');
  add();
}

add('### Diagnóstico del cambio de backend');
add();
const mainA = analyzeConfigPhase(j);
const evidence = [{ file: path.basename(input), rec: j }];
for (const f of evidenceFiles) {
  const p = path.resolve(f);
  if (!fs.existsSync(p) || p === input) continue;
  try {
    evidence.push({ file: path.basename(p), rec: JSON.parse(fs.readFileSync(p, 'utf8')) });
  } catch (e) {
    console.warn(`[evidence] no pude leer ${f}: ${e.message}`);
  }
}

if (evidence.some((e) => analyzeConfigPhase(e.rec).hasPack)) {
  const rows = evidence.filter((e) => e === evidence[0] || (e.rec.packetLog || []).length);
  table(
    ['Corrida', 'Cliente', 'Backend', 'Pack', 'finish_configuration', 'keep_alive', 'Expulsión'],
    rows.map((e) => {
      const a = analyzeConfigPhase(e.rec);
      const m = e.rec.meta || {};
      const backend = (e.rec.serverSwitch && e.rec.serverSwitch.to) ||
        ((e.rec.guiClicks || []).length ? `menú slot ${e.rec.guiClicks[0].slot}` : '—');
      return [
        e.file,
        m.requestedVersion || '?',
        backend,
        a.hasPack ? 'sí' : 'no',
        a.finish ? 'sí' : '**NO**',
        a.hasPack ? String(a.keepAlives) : '—',
        a.kickAfter != null ? `${a.kickAfter} s` : '—',
      ];
    })
  );
}

if (mainA.hasPack && !mainA.finish) {
  add(`Tras \`add_resource_pack\`: **${mainA.keepAlives}** \`keep_alive\` recibidos y \`finish_configuration\` **NO**. La fase de **configuración** nunca se completó, así que el jugador jamás entró al mundo: no es un problema de movimiento, permisos ni autenticación.`);
  add();
  const townyPlayers = evidence.map((e) => modePlayers(e.rec, /towny/i)).find(Boolean);
  if (townyPlayers) {
    add(`El selector de modos informa **${townyPlayers}** jugadores en ese backend, así que **sí acepta clientes reales**. El corte es específico del cliente de esta herramienta: el proxy anuncia 1.9–26.3, pero la traducción de la fase de configuración hacia un backend 26.3 no se completa con un cliente 26.1 (protocolo 775, el máximo que soporta mineflayer).`);
    add();
    add('Conclusión: **limitación de la herramienta**, no un fallo del backend. Para auditar ese modo hace falta un cliente 26.3 real o datos de protocolo 777, que todavía no están publicados en `minecraft-data`.');
    add();
  }
}

if (j.packetLog && j.packetLog.length) {
  const seq = j.packetLog.filter((p) => p.state === 'configuration');
  if (seq.length) {
    const lines = [];
    let ka = 0;
    for (const p of seq) {
      if (p.name === 'keep_alive') {
        ka++;
        continue;
      }
      if (ka) {
        lines.push(`    keep_alive x${ka}`);
        ka = 0;
      }
      lines.push(`${(p.dir === 'out' ? '->' : 'in ').padEnd(3)} ${p.name}${p.result !== undefined ? ` result=${p.result}` : ''}`);
    }
    if (ka) lines.push(`    keep_alive x${ka}`);
    add('#### Secuencia de configuración (sin repetir `keep_alive`)');
    add();
    add('```');
    for (const l of lines.slice(-24)) add(l);
    add('```');
    add();
  }
}

add('### Mensajes del servidor (chat capturado)');add();
const chat = (j.chat || []).filter(Boolean);
if (!chat.length) {
  add('_Sin mensajes capturados._');
  add();
} else {
  // Colapsa el spam de actionbar para que lo relevante no se pierda.
  const counts = new Map();
  for (const c of chat) counts.set(c, (counts.get(c) || 0) + 1);
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  add('```');
  for (const [c, n] of ordered) add(n > 1 ? `${c.slice(0, 220)}   (x${n})` : c.slice(0, 220));
  add('```');
  add();
  if (chat.some((c) => /error detected|not installed|misconfigur/i.test(c))) {
    add('⚠️ **El servidor emitió un mensaje de error de configuración a un jugador no autenticado.** Ver la línea correspondiente arriba: es evidencia directa y conviene reportarla al cliente.');
    add();
  }
}

add('## 5. Comandos visibles');
add();
listBlock((j.commands && j.commands.topLevel) || [], 80);

add('## 6. Limitaciones de este reconocimiento');
add();
add('- El árbol de comandos de Paper 1.20.5+ viene **filtrado por permisos**: refleja lo que la cuenta puede usar, no todo lo registrado.');
add('- El tab-complete puede estar filtrado o cortado en 1000 sugerencias.');
add('- No se accedió al estado server-side (playerdata, DB, logs), así que **no se pueden confirmar duplicationes** desde este informe.');
add('- La ausencia de un plugin en este informe no prueba que no esté instalado.');
add('- Los plugins marcados como `INFERRED` se deducen del nombre de los comandos: un comando puede venir de otro plugin, y la inferencia no incluye versión.');
add('- Si el tab-complete devuelve 0 entradas y la medición de latencia ronda el timeout, la causa suele ser que el servidor no responde a `tab_complete` antes de la autenticación.');
add('- El cliente de esta herramienta soporta hasta la versión que declara soportar su librería de protocolo. Si un backend corre una versión más nueva, usá ViaProxy como traductor; si la fase de configuración (resource pack) no se traduce bien, ese backend queda fuera de alcance aunque el resto del servidor sí sea accesible.');
add();

add('## 7. Próximos pasos sugeridos');
add();
add('1. Contrastar versiones de los plugins listados contra sus changelogs (buscar `dupe`, `exploit`, `race`, `security`).');
add('2. **Desbloquear Towny:** probar el mismo ingreso con un cliente real 26.3 y reportar si el pack carga y el mundo abre. Si el cliente real entra, el fallo es de traducción de versión (26.1→26.3); si también falla, es un bug de configuración del backend.');
add('3. Repetir con una sesión autorizada en ventana coordinada y `--profile towny` para capturar versión de Towny y precios (una vez resuelto el acceso).');
add('4. Verificar cualquier hipótesis con relog + cambio de contexto + restart coordinado.');
add('5. Documentar impacto económico estimado antes de reportar.');
add();

add('## 8. Anexo: trazabilidad de comandos');
add();
const sent = j.sentCommands || [];
const blocked = j.blockedCommands || [];
if (!sent.length && !blocked.length) {
  add('_No se envió ningún comando en esta corrida._');
  add();
} else {
  if (sent.length) {
    add(`Comandos enviados: **${sent.length}**`);
    add();
    table(['Hora', 'Comando'], sent.map((s) => [s.at, `\`${s.cmd}\``]));
  }
  if (blocked.length) {
    add(`Comandos bloqueados por el control de alcance: **${blocked.length}**`);
    add();
    listBlock(blocked, 40);
  }
}
if (j.aborted) {
  add(`⚠️ **Corrida abortada:** ${j.aborted.reason} (${j.aborted.at})`);
  add();
}
if (typeof j.piiRedacted === 'number' && j.piiRedacted > 0) {
  add(`Nombres de jugadores redactados en este informe: **${j.piiRedacted}**`);
  add();
}

const outFile = path.join(
  OUT_DIR,
  `informe-${host.replace(/[^a-z0-9.-]/gi, '_')}-${new Date().toISOString().slice(0, 10)}${tag ? '-' + tag : ''}.md`
);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, '\ufeff' + rows.join('\n'), 'utf8');

console.log(`Informe generado: ${outFile}`);
console.log(`Fuente: ${input}`);
console.log(`Plugins: ${nsKeys.length ? nsKeys.join(', ') : 'ninguno por tab-complete'}${inferred.size ? ' | inferidos: ' + [...inferred.keys()].join(', ') : ''}`);
