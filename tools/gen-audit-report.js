#!/usr/bin/env node
'use strict';

// gen-audit-report.js — consolida las evidencias de una auditoría en un
// informe Markdown único. Genérico: todo se pasa por argumentos y lo que
// falta se marca como "_archivo faltante_" sin romper el informe.
//
// No se conecta a nada: solo lee JSONs/Markdown de out/.
//
// Uso:
//   node tools/gen-audit-report.js ^
//     --sweep out/gui-2026-...-towny.json ^
//     --cf out/cf-test-01.json,out/cf-test-02.json ^
//     --plugins out/plugins.md ^
//     --host mc.ejemplo.com --account Auditor ^
//     --window "2026-11-23T14:00:00-03:00 -> 2026-11-23T15:00:00-03:00" ^
//     --via "ViaProxy 3.4.14 local, --freeze" ^
//     --out out/informe-auditoria.md

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 2) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const n = argv[i + 1];
      out[a.slice(2)] = n !== undefined && !n.startsWith('--') ? n : true;
      if (out[a.slice(2)] !== true) i++;
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const OUT = String(args.out || path.join(ROOT, 'out', `informe-auditoria-${new Date().toISOString().slice(0, 10)}.md`));

function readJsonSafe(file) {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(path.resolve(String(file)), 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    console.error(`[!] no pude leer ${file}: ${e.message}`);
    return null;
  }
}

function readTextSafe(file) {
  if (!file) return null;
  try {
    return fs.readFileSync(path.resolve(String(file)), 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    console.error(`[!] no pude leer ${file}: ${e.message}`);
    return null;
  }
}

const MISSING = (what) => `_${what} — archivo faltante_`;

const sweep = readJsonSafe(args.sweep);
const cfFiles = String(args.cf || '').split(',').map((s) => s.trim()).filter(Boolean);
const cfRuns = cfFiles.map((f) => ({ file: path.basename(f), json: readJsonSafe(f) }));
const plugins = readTextSafe(args.plugins);

const HOST = String(args.host || (sweep && sweep.meta && sweep.meta.target && sweep.meta.target.host) || '?');
const ACCOUNT = String(args.account || (sweep && sweep.meta && sweep.meta.scope && sweep.meta.scope.account) || '?');
const WINDOW = String(args.window || (sweep && sweep.meta && sweep.meta.scope && sweep.meta.scope.windowFrom) || 'no declarada');
const VIA = String(args.via || 'directo');

const lines = [];
const add = (s = '') => lines.push(s);

const probe = (j, k) => (j && j.probes && j.probes[k]) || [];
const money = (j) => {
  const arr = probe(j, '/money').concat(j && j.balanceAfter != null ? [] : []);
  return arr;
};

// ---------------------------------------------------------------- cabecera

add(`# Informe de auditoría — ${HOST}`);
add();
add(`**Fecha de generación:** ${new Date().toISOString()}`);
add(`**Objetivo:** \`${HOST}\``);
add(`**Cuenta:** \`${ACCOUNT}\``);
add(`**Ventana autorizada:** ${WINDOW}`);
add(`**Vía de conexión:** ${VIA}`);
add();
add('---');
add();

// ---------------------------------------------------------------- resumen

add('## 1. Resumen de la corrida');
add();
const versionName = sweep && sweep.version ? sweep.version.name : null;
const versionProto = sweep && sweep.version ? sweep.version.protocol : null;
if (sweep) {
  add(`- **Versión del servidor:** ${versionName || '?'} (protocolo ${versionProto ?? '?'})`);
  add(`- **Comandos visibles:** ${(sweep.commands && sweep.commands.topLevel ? sweep.commands.topLevel.length : '?')}`);
  add(`- **Namespaces por tab-complete:** ${Object.keys(sweep.tabCompleteNamespaces || {}).length}`);
  add(`- **Comandos enviados:** ${(sweep.sentCommands || []).length}; bloqueados por el guard: ${(sweep.blockedCommands || []).length}`);
  if (sweep.aborted) add(`- ⚠️ **Corrida abortada:** ${sweep.aborted.reason}`);
  const errs = (sweep.errors || []).length;
  if (errs) add(`- Avisos/errores registrados: ${errs}`);
} else {
  add(MISSING('barrido (JSON de recon/GUI)'));
}
add();

// respuestas clave de sondeos (data-driven, sin narrativa hardcodeada)
const KEYS = ['/version', '/towny version', '/towny prices', '/tps'];
add('## 2. Sondeos clave');
add();
for (const k of KEYS) {
  const resp = probe(sweep, k);
  if (resp.length) {
    add(`**${k}**`);
    add('```');
    resp.slice(0, 6).forEach((l) => add(l.slice(0, 200)));
    add('```');
  }
}
add();

// ---------------------------------------------------------------- coinflip

add('## 3. Pruebas de coinflip (`cf-test`)');
add();
if (cfRuns.length && cfRuns.some((r) => r.json)) {
  add('| Corrida | Monto | Delay delete | saldo inicial | saldo final | ¿Sospecha de doble reembolso? |');
  add('|---|---|---|---|---|---|');
  for (const r of cfRuns) {
    if (!r.json) continue;
    const m = r.json.meta || {};
    const o = r.json.outcome || {};
    add(`| ${r.file} | ${m.amount ?? '?'}$ | ${m.deleteDelayMs ?? '?'} ms | ${o.balance0 != null ? o.balance0 + '$' : '?'} | ${o.balance2 != null ? o.balance2 + '$' : '?'} | ${o.suspectedDoubleRefund ? 'SÍ (reproducir antes de confirmar)' : 'no'} |`);
  }
  add();
  for (const r of cfRuns) {
    if (!r.json) continue;
    const o = r.json.outcome || {};
    if (o.note) add(`- \`${r.file}\`: ${o.note}`);
    if (o.kicked) add(`- \`${r.file}\`: ⚠️ expulsado: ${String(o.kicked).slice(0, 160)}`);
  }
} else if (cfRuns.length) {
  add(MISSING('JSONs de cf-test'));
} else {
  add('_Sin corridas de cf-test declaradas (--cf)._');
}
add();

// ---------------------------------------------------------------- plugins

add('## 4. Plugins detectados');
add();
if (plugins) {
  add(plugins.replace(/^# .*\n/, ''));
} else {
  add(MISSING('lista de plugins (generala con tools/plugin-list.js)'));
}
add();

// ---------------------------------------------------------------- reglas

add('## 5. Trazabilidad');
add();
add('- Cada corrida dejó su JSON completo en `out/` (comandos enviados, bloqueados, latencias, aborts).');
add('- Los secretos de autenticación se enmascaran en la evidencia (`/login ****`).');
add('- Cualquier hallazgo debe reproducirse en una segunda corrida independiente antes de declararse confirmado.');
add();

const text = lines.join('\n');
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(path.resolve(OUT), text, 'utf8');
console.log(`[ok] informe generado: ${OUT}`);
