'use strict';

// stats.js — agrega estadísticas de las corridas guardadas en out/.
// Módulo PURO (sin dependencias de Electron): main.js lo llama por IPC y se
// puede testear directo con node. Tolerante: out/ puede estar vacío o tener
// JSONs de tools que no son corridas de recon (se ignoran con skipped++).

const fs = require('fs');
const path = require('path');

function looksLikeRecon(j) {
  if (!j || typeof j !== 'object') return false;
  return Boolean(
    (j.meta && j.meta.tool) ||
    j.sentCommands ||
    j.blockedCommands ||
    j.tabCompleteNamespaces ||
    (j.meta && j.meta.scope)
  );
}

function pluginsFromProbe(j) {
  const lines = (j.probes && (j.probes['/plugins'] || j.probes['/pl'])) || [];
  const set = new Set();
  for (const raw of lines) {
    const l = String(raw).replace(/§[0-9a-fk-orx]/gi, '').trim();
    const bullet = l.match(/^[-*]\s*(.+)$/);
    const named = l.match(/\b([A-Za-z0-9_.-]+)\s+v?(\d+\.\d+(?:\.\d+)?)/);
    if (bullet) set.add(bullet[1].trim().toLowerCase());
    else if (named) set.add(named[1].toLowerCase());
  }
  return set;
}

function dayKey(iso) {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function collectStats(outDir, { days = 14 } = {}) {
  const stats = {
    sessions: { total: 0, readOnly: 0, withWrites: 0, aborted: 0, lastAt: null, lastHost: null, lastMode: null },
    commands: { sent: 0, blocked: 0, blockRatio: 0 },
    latency: { count: 0, avgMs: null, maxMs: null, total: 0 },
    surface: { namespaces: 0, plugins: 0, windows: 0, packs: 0, commandsSeen: 0 },
    errors: { count: 0 },
    activity: [],
    files: { scanned: 0, skipped: 0 },
  };

  const allNamespaces = new Set();
  const allPlugins = new Set();
  const perDay = new Map();

  let entries = [];
  try {
    entries = fs.readdirSync(outDir).filter((f) => f.endsWith('.json'));
  } catch {
    return stats; // sin out/
  }

  for (const f of entries) {
    const p = path.join(outDir, f);
    let j;
    try {
      j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      stats.files.skipped++;
      continue;
    }
    if (!looksLikeRecon(j)) {
      stats.files.skipped++;
      continue;
    }
    stats.files.scanned++;

    const scope = (j.meta && j.meta.scope) || {};
    const sent = Array.isArray(j.sentCommands) ? j.sentCommands.length : 0;
    const blocked = Array.isArray(j.blockedCommands) ? j.blockedCommands.length : 0;
    stats.sessions.total++;
    if (scope.readOnly === false) stats.sessions.withWrites++;
    else stats.sessions.readOnly++;
    if (j.aborted) stats.sessions.aborted++;
    stats.commands.sent += sent;
    stats.commands.blocked += blocked;

    if (Array.isArray(j.latencies)) {
      for (const l of j.latencies) {
        if (!Number.isFinite(l)) continue;
        stats.latency.count++;
        stats.latency.total += l;
        if (stats.latency.maxMs == null || l > stats.latency.maxMs) stats.latency.maxMs = l;
      }
    }

    const ns = j.tabCompleteNamespaces || {};
    for (const k of Object.keys(ns)) allNamespaces.add(k);
    for (const pl of pluginsFromProbe(j)) allPlugins.add(pl);
    if (Array.isArray(j.windows)) stats.surface.windows += j.windows.length;
    if (Array.isArray(j.resourcePacks)) stats.surface.packs += j.resourcePacks.length;
    if (j.commands && Array.isArray(j.commands.topLevel)) stats.surface.commandsSeen += j.commands.topLevel.length;
    if (Array.isArray(j.errors)) stats.errors.count += j.errors.length;

    const at = (j.meta && j.meta.generatedAt) || null;
    if (at) {
      const day = dayKey(at);
      if (day) perDay.set(day, (perDay.get(day) || 0) + 1);
      if (!stats.sessions.lastAt || at > stats.sessions.lastAt) {
        stats.sessions.lastAt = at;
        stats.sessions.lastHost = (j.meta && j.meta.target && j.meta.target.host) || null;
        stats.sessions.lastMode = (j.meta && j.meta.scope && j.meta.scope.account) || null;
      }
    }
  }

  if (stats.commands.sent + stats.commands.blocked > 0) {
    stats.commands.blockRatio = Math.round(
      (stats.commands.blocked / (stats.commands.sent + stats.commands.blocked)) * 100
    );
  }
  if (stats.latency.count) {
    stats.latency.avgMs = Math.round(stats.latency.total / stats.latency.count);
  }
  delete stats.latency.total;

  stats.surface.namespaces = allNamespaces.size;
  stats.surface.plugins = allPlugins.size;
  stats.surface.namespacesList = [...allNamespaces].sort().slice(0, 40);
  stats.surface.pluginsList = [...allPlugins].sort().slice(0, 40);

  // actividad: últimos N días (incluye hoy)
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    stats.activity.push({ date: key, count: perDay.get(key) || 0 });
  }

  return stats;
}

module.exports = { collectStats, looksLikeRecon };
