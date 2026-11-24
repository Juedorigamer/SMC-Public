#!/usr/bin/env node
'use strict';

// llm-digest.js — condensa el JSON de una corrida de recon en un "digest"
// compacto, pensado para alimentar el contexto de un LLM (o para leer rápido
// lo esencial de un servidor). Offline: solo lee archivos.
//
// Uso:
//   node tools/llm-digest.js out/recon-....json
//   node tools/llm-digest.js out/recon-....json --format json
//   node tools/llm-digest.js a.json b.json --out out/digest.md
//
// También es un módulo: const { digest } = require('./llm-digest');

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(String(file)), 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    return { __error: `no pude leer ${file}: ${e.message}` };
  }
}

const cap = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);
const n = (v) => (v == null ? '?' : v);

function digestServer(j, host) {
  const out = [];
  const meta = j.meta || {};
  const target = meta.target || {};
  out.push(`## Servidor: ${host || target.host || '?'}:${target.port || '?'}`);
  out.push('');
  const v = j.version || {};
  out.push(`- **Versión:** ${v.name || '?'} (protocolo ${n(v.protocol)})`);
  if (j.brand) out.push(`- **Software (brand):** ${j.brand}`);
  if (j.statusNative && j.statusNative.version) {
    out.push(`- **Protocolo nativo anunciado:** ${j.statusNative.version.protocol} (${j.statusNative.version.name})`);
  }
  if (Array.isArray(j.proxyServers) && j.proxyServers.length) {
    out.push(`- **Backends visibles:** ${j.proxyServers.slice(0, 12).join(', ')}`);
  }
  if (j.serverSwitch) {
    const sw = j.serverSwitch;
    out.push(`- **Cambio a backend:** ${sw.to || '?'} — ${sw.ok ? 'login recibido' : 'SIN login (falló)'}`);
  }
  const scope = (meta.scope || {});
  if (scope.readOnly != null) {
    out.push(`- **Modo de la corrida:** ${scope.readOnly ? 'read-only' : 'con escrituras'}; ${n(scope.maxCommands)} comando(s) tope`);
  }
  if (j.aborted) out.push(`- ⚠️ **Abortada:** ${j.aborted.reason}`);
  if (j.errors && j.errors.length) out.push(`- Avisos/errores: ${j.errors.length} (ver JSON)`);
  out.push('');
  return out.join('\n');
}

function digestSurface(j) {
  const out = [];
  const cmds = j.commands || {};
  const nsTab = j.tabCompleteNamespaces || {};
  const nsTree = cmds.byNamespace || {};
  out.push('## Superficie (plugins y comandos)');
  out.push('');
  out.push(`- **Comandos visibles para la cuenta:** ${n(cmds.topLevel ? cmds.topLevel.length : '?')}${cmds.literalCount != null ? ` (literales: ${cmds.literalCount})` : ''}`);
  const tabKeys = Object.keys(nsTab).sort((a, b) => nsTab[b].length - nsTab[a].length);
  if (tabKeys.length) {
    out.push(`- **Namespaces por tab-complete (${tabKeys.length}):**`);
    for (const k of cap(tabKeys, 25)) out.push(`  - \`${k}\` (${nsTab[k].length} comandos)`);
  }
  const treeKeys = Object.keys(nsTree);
  if (treeKeys.length) {
    out.push(`- **Namespaces en el árbol de comandos (${treeKeys.length}):** ${cap(treeKeys.sort(), 25).join(', ')}`);
  }
  const plugins = extractPluginsFromProbe(j);
  if (plugins.length) {
    out.push(`- **Plugins (/plugins):** ${plugins.slice(0, 40).join(' · ')}`);
  }
  const regNs = Object.keys(j.registries || {});
  if (regNs.length) out.push(`- **Namespaces custom en registries:** ${cap(regNs, 15).join(', ')}`);
  const recNs = Object.keys(j.recipes || {});
  if (recNs.length) out.push(`- **Recetas custom:** ${cap(recNs, 15).join(', ')}`);
  if (Array.isArray(j.pluginChannels) && j.pluginChannels.length) {
    out.push(`- **Canales de plugin:** ${cap(j.pluginChannels.sort(), 15).join(', ')}`);
  }
  out.push('');
  return out.join('\n');
}

function extractPluginsFromProbe(j) {
  const lines = (j.probes && (j.probes['/plugins'] || j.probes['/pl'])) || [];
  const set = new Set();
  for (const raw of lines) {
    const l = String(raw).replace(/§[0-9a-fk-orx]/gi, '').trim();
    const bullet = l.match(/^[-*]\s*(.+)$/);
    const named = l.match(/\b([A-Za-z0-9_.-]+)\s+v?(\d+\.\d+(?:\.\d+)?)/);
    if (bullet) set.add(bullet[1].trim());
    else if (named) set.add(`${named[1]} v${named[2]}`);
  }
  return [...set].sort();
}

function digestAuthAndEcon(j) {
  const out = [];
  const authHints = j.authHints || [];
  if (authHints.length) {
    out.push('## Autenticación');
    out.push('');
    for (const h of cap(authHints, 4)) out.push(`- ${String(h).slice(0, 160)}`);
    out.push('');
  }
  const probes = j.probes || {};
  const econKeys = Object.keys(probes).filter((k) => /^(\/money|\/baltop|\/bal|\/towny prices)/i.test(k));
  if (econKeys.length) {
    out.push('## Economía (respuestas de sondeos)');
    out.push('');
    for (const k of econKeys) {
      const lines = cap(probes[k], 4).map((l) => `  ${String(l).slice(0, 140)}`);
      if (lines.length) out.push(`**${k}**`); lines.forEach((l) => out.push(l));
    }
    out.push('');
  }
  if (Array.isArray(j.windows) && j.windows.length) {
    out.push(`## GUIs capturadas: ${j.windows.length}`);
    out.push('');
    for (const w of cap(j.windows, 12)) {
      out.push(`- \`${w.cmd || '?'}\` → "${(w.title || '').slice(0, 60)}" (${(w.slots || []).length} ítems${w.clickedSlot != null ? `, clic en slot ${w.clickedSlot}` : ''})`);
    }
    out.push('');
  }
  return out.join('\n');
}

function digestRun(j) {
  const out = [];
  const sent = j.sentCommands || [];
  const blocked = j.blockedCommands || [];
  out.push('## Corrida');
  out.push('');
  out.push(`- **Comandos enviados:** ${sent.length}; **bloqueados por el guard:** ${blocked.length}`);
  if (blocked.length) out.push(`  - bloqueados: ${cap(blocked, 8).join(' | ')}`);
  if (Array.isArray(j.resourcePacks) && j.resourcePacks.length) {
    out.push(`- **Resource packs ofrecidos:** ${j.resourcePacks.length}`);
  }
  if (j.droppedMoves) out.push(`- Paquetes de movimiento descartados (freeze): ${j.droppedMoves}`);
  if (Array.isArray(j.guiClicks) && j.guiClicks.length) {
    out.push(`- Clics GUI registrados: ${j.guiClicks.length}`);
  }
  out.push('');
  return out.join('\n');
}

function digest(json, { host } = {}) {
  if (json.__error) return `⚠️ ${json.__error}`;
  const parts = [
    digestServer(json, host),
    digestSurface(json),
    digestAuthAndEcon(json),
    digestRun(json),
    '_Digest generado por SMC (`tools/llm-digest.js`). El JSON completo tiene más detalle (slots, lore, latencias)._',
  ];
  return parts.join('\n');
}

function digestJson(json, opts) {
  if (json.__error) return { error: json.__error };
  const d = digest(json, opts);
  return {
    server: {
      host: (json.meta && json.meta.target && json.meta.target.host) || null,
      port: (json.meta && json.meta.target && json.meta.target.port) || null,
      version: (json.version && json.version.name) || null,
      protocol: (json.version && json.version.protocol) || null,
      brand: json.brand || null,
      backends: json.proxyServers || [],
    },
    surface: {
      visibleCommands: json.commands && json.commands.topLevel ? json.commands.topLevel.length : null,
      tabNamespaces: json.tabCompleteNamespaces || {},
      treeNamespaces: Object.keys((json.commands && json.commands.byNamespace) || {}),
      plugins: extractPluginsFromProbe(json),
      customRegistries: Object.keys(json.registries || {}),
      channels: json.pluginChannels || [],
    },
    auth: { hints: (json.authHints || []).slice(0, 5) },
    windows: (json.windows || []).slice(0, 12).map((w) => ({ cmd: w.cmd, title: w.title, slots: (w.slots || []).length })),
    run: {
      sent: (json.sentCommands || []).length,
      blocked: (json.blockedCommands || []).length,
      aborted: json.aborted || null,
    },
    digestText: d,
  };
}

// ------------------------------------------------------------------- CLI
if (require.main === module) {
  const argv = process.argv.slice(2);
  const files = argv.filter((a) => !a.startsWith('--'));
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const format = (flag('--format') || 'md').toLowerCase();
  const outPath = flag('--out');
  if (!files.length) {
    console.error('uso: node tools/llm-digest.js <recon.json> [otro.json] [--format md|json] [--out archivo]');
    process.exit(1);
  }
  const chunks = [];
  for (const f of files) {
    const j = readJsonSafe(f);
    if (format === 'json') chunks.push(JSON.stringify(digestJson(j), null, 2));
    else chunks.push(digest(j));
  }
  const text = chunks.join('\n\n---\n\n');
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), text, 'utf8');
    console.log(`[ok] digest: ${outPath}`);
  } else {
    console.log(text);
  }
}

module.exports = { digest, digestJson, readJsonSafe };
