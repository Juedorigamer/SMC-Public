#!/usr/bin/env node
'use strict';

// Genera una lista Markdown de todos los plugins/namespaces detectados en un JSON
// de SMC. No se conecta a ningún servidor: solo lee la evidencia.
//
// Uso:
//   node tools/plugin-list.js [out/recon.json] [out/plugins.md]
// Sin argumentos usa el JSON más reciente de out/.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'out');

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

const CHANNEL_PLUGIN = {
  'vv:': 'Velocity',
  'nlogin:': 'nLogin',
  'minecraft:': 'Vanilla / Minecraft',
  'bungeecord:': 'BungeeCord',
  'geyser:': 'GeyserMC',
  'floodgate:': 'Floodgate',
  'luckperms:': 'LuckPerms',
  'towny:': 'Towny',
  'oraxen:': 'Oraxen',
  'itemsadder:': 'ItemsAdder',
};

function looksLikeRecon(j) {
  return !!j && typeof j === 'object' &&
    !!(j.tabCompleteNamespaces || j.commands || j.registries);
}

function latestJson() {
  if (!fs.existsSync(OUT_DIR)) return null;
  const files = fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, t: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) return null;
  // El más reciente debe parecer un JSON de recon: si es un JSON de tool,
  // abortar en vez de emitir "Total: 0 plugins" con host "?".
  const newest = files[0];
  const full = path.join(OUT_DIR, newest.f);
  let j = null;
  let parseErr = null;
  try {
    j = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    parseErr = e.message;
  }
  if (!looksLikeRecon(j)) {
    console.error(
      `[!] el JSON más reciente de out/ (${newest.f}) ` +
        (parseErr ? `no se pudo parsear: ${parseErr}` : 'no parece un JSON de recon (sin tabCompleteNamespaces/commands/registries)')
    );
    console.error('    Pasá la ruta explícita: node tools/plugin-list.js out/recon.json');
    process.exit(2);
  }
  return full;
}

const input = process.argv[2] ? path.resolve(process.argv[2]) : latestJson();
if (!input || !fs.existsSync(input)) {
  console.error('No encontré un JSON. Pasá la ruta: node tools/plugin-list.js out/recon.json');
  process.exit(1);
}
const outPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(OUT_DIR, `plugins-${new Date().toISOString().slice(0, 10)}.md`);

let j;
try {
  j = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
  console.error(`[!] ${input} no es JSON válido: ${e.message}`);
  process.exit(2);
}

// clave -> { plugin, namespaces:Set, evidence:Set, commands:Set, versions:Set }
const entries = new Map();
function add(plugin, ns, evidence, commands, version) {
  const key = String(plugin).toLowerCase();
  if (!entries.has(key)) {
    entries.set(key, {
      plugin: plugin || '—',
      namespaces: new Set(),
      evidence: new Set(),
      commands: new Set(),
      versions: new Set(),
    });
  }
  const e = entries.get(key);
  if (ns) e.namespaces.add(ns);
  if (evidence) e.evidence.add(evidence);
  for (const c of commands || []) e.commands.add(String(c));
  if (version) e.versions.add(String(version));
}

// 1) Namespaces de tab-complete
const tabNs = j.tabCompleteNamespaces || {};
for (const [ns, cmds] of Object.entries(tabNs)) {
  add(KNOWN_NS[ns] || ns, ns, 'tab-complete', cmds);
}

// 2) Registries custom (items/bloques/encantamientos)
for (const [ns, entriesArr] of Object.entries(j.registries || {})) {
  add(KNOWN_NS[ns] || ns, ns, 'registries', entriesArr);
}

// 3) Canales de plugin
for (const ch of j.pluginChannels || []) {
  const prefix = Object.keys(CHANNEL_PLUGIN).find((p) => ch.startsWith(p));
  if (prefix) add(CHANNEL_PLUGIN[prefix], ch, 'canal', []);
}

// 4) Plugins listados por /plugins o /pl (si hubo permisos)
const probeLines = [...(j.probes?.['/plugins'] || []), ...(j.probes?.['/pl'] || [])];
for (const line of probeLines) {
  const m = /^\s*[-*]?\s*([A-Za-z0-9_.-]+)\s+v?(\d+\.\d+(?:\.\d+)?[A-Za-z0-9.\-+]*)/.exec(line);
  // Clave canónica (el KNOWN_NS si existe): evita duplicar "Towny" y
  // "Towny v0.103.2.15" como dos plugins. La versión va en campo aparte.
  if (m) add(KNOWN_NS[m[1].toLowerCase()] || m[1], '—', '/plugins', [], m[2]);
}

// 5) Inferidos del árbol de comandos
const CMD_PLUGIN = {
  nlogin: 'nLogin', register: 'nLogin', reg: 'nLogin', login: 'nLogin', l: 'nLogin',
  log: 'nLogin', changepass: 'nLogin', changepassword: 'nLogin', premium: 'nLogin',
  cracked: 'nLogin', offline: 'nLogin', recover: 'nLogin',
  lpv: 'LuckPerms (Velocity)', luckpermsvelocity: 'LuckPerms (Velocity)',
  geyser: 'GeyserMC', ultracosmetics: 'UltraCosmetics',
  store: 'Plugin de tienda (Tebex/Buycraft)', discord: 'DiscordSRV',
  server: 'Velocity (proxy)', 'velocity:callback': 'Velocity (proxy)',
  bedrockgen_ex: 'custom (generador Bedrock)', ajp: 'no identificado (ajp)',
};
for (const cmd of j.commands?.topLevel || []) {
  const p = CMD_PLUGIN[cmd];
  if (p) add(p, '—', 'árbol de comandos', [cmd]);
}

// 6) Namespaces del árbol de comandos (declare_commands)
for (const [ns, cmds] of Object.entries(j.commands?.byNamespace || {})) {
  add(KNOWN_NS[ns] || ns, ns, 'árbol de comandos', cmds);
}

const rows = [...entries.values()]
  .map((e) => ({
    ...e,
    cmdCount: e.commands.size,
    evidence: [...e.evidence].sort().join(', '),
    namespaces: [...e.namespaces].sort().join(', ') || '—',
    version: [...e.versions].sort().join(' / '),
    sample: [...e.commands].slice(0, 6).join(', '),
  }))
  .sort((a, b) => {
    if (b.cmdCount !== a.cmdCount) return b.cmdCount - a.cmdCount;
    return a.plugin.localeCompare(b.plugin);
  });

const lines = [];
lines.push(`# Plugins detectados — ${(j.meta?.target?.host) || '?'}`);
lines.push('');
lines.push(`- **Fuente:** \`${path.basename(input)}\``);
lines.push(`- **Generado:** ${new Date().toISOString()}`);
lines.push(`- **Software:** ${j.brand || j.version?.name || 'no informado'}`);
lines.push(`- **Total de plugins/namespaces:** ${rows.length}`);
lines.push('');
lines.push('> La lista sale de tab-complete, registries, canales y árbol de comandos. No confirma versión ni que el plugin esté activo.');
lines.push('');
lines.push('| # | Plugin | Versión | Namespace(s) | Evidencia | Comandos | Muestra |');
lines.push('|---|---|---|---|---|---|---|');
rows.forEach((r, i) => {
  lines.push(`| ${i + 1} | ${r.plugin} | ${r.version || '—'} | \`${r.namespaces}\` | ${r.evidence} | ${r.cmdCount} | ${r.sample || '—'} |`);
});
lines.push('');

const unmapped = Object.keys(tabNs).filter((ns) => !KNOWN_NS[ns]);
if (unmapped.length) {
  lines.push('## Namespaces sin mapeo conocido');
  lines.push('');
  for (const ns of unmapped.sort()) {
    const cmds = tabNs[ns] || [];
    lines.push(`- \`${ns}\` — ${cmds.length} comando(s): ${cmds.slice(0, 8).join(', ')}${cmds.length > 8 ? '…' : ''}`);
  }
  lines.push('');
}

if ((j.pluginChannels || []).length) {
  lines.push('## Canales de plugin observados');
  lines.push('');
  for (const ch of [...new Set(j.pluginChannels)].sort()) lines.push(`- \`${ch}\``);
  lines.push('');
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`Lista generada: ${outPath}`);
console.log(`Plugins/namespaces: ${rows.length}`);
console.log(`Fuente: ${input}`);
