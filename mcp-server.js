#!/usr/bin/env node
'use strict';

// mcp-server.js — servidor MCP (stdio) para SMC.
//
// Expone el toolkit a agentes LLM (OpenCode, Claude Desktop, etc.) con un
// diseño deliberadamente conservador:
//   - TODO lo que toca red es READ-ONLY: no existe ningún tool que habilite
//     escrituras o que acepte contraseñas por argumento.
//   - recon exige la ventana autorizada (ISO con zona horaria) y la cuenta;
//     el login solo se pasa como RUTA de archivo dentro de .secrets/.
//   - Las tools offline (digest, cve-check, reconcile, econ) no tocan red.
//
// Config en OpenCode (opencode.json):
//   "mcp": { "servers": { "smc": {
//     "type": "local",
//     "command": ["node", "mcp-server.js"],
//     "cwd": "."
//   } } }
//
// Protocolo: JSON-RPC 2.0 delimitado por líneas sobre stdio (MCP "legacy").

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { digest } = require('./tools/llm-digest');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'out');
const SECRETS_DIR = path.join(ROOT, '.secrets');
const NODE_BIN = process.execPath;

// ------------------------------------------------------------------ helpers

function jout(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, result) {
  jout({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  jout({ jsonrpc: '2.0', id, error: { code, message } });
}

function logErr(msg) {
  process.stderr.write(`[smc-mcp] ${msg}\n`);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(String(file)), 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    return null;
  }
}

function isIsoWithOffset(s) {
  return typeof s === 'string' && /(Z|[+-]\d{2}:?\d{2})\s*$/.test(s.trim()) && Number.isFinite(Date.parse(s));
}

// Ejecuta un script del proyecto con el mismo Node que corre este servidor.
// Devuelve {code, stdout}.
function runScript(relScript, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const child = spawn(NODE_BIN, [path.join(ROOT, relScript), ...args], {
      cwd: ROOT,
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* nada */ }
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: String(e && e.message) });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: err });
    });
  });
}

// ------------------------------------------------------------------ tools

const TOOLS = [
  {
    name: 'ping_server',
    description:
      'Ping público de un servidor Minecraft (lo mismo que ve cualquier cliente en la lista de servidores): ' +
      'versión, protocolo, MOTD, jugadores. No necesita cuenta ni autenticación. Usalo como paso 0 para aprender qué corre un servidor.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Hostname o IP' },
        port: { type: 'number', description: 'Puerto (default 25565)' },
      },
      required: ['host'],
    },
    handler: async (a) => {
      const host = String(a.host || '').trim();
      const port = Number(a.port || 25565);
      if (!host) return { isError: true, text: 'host vacío' };
      if (!Number.isInteger(port) || port < 1 || port > 65535) return { isError: true, text: 'puerto inválido' };
      let mc;
      try {
        mc = require('minecraft-protocol');
      } catch {
        return {
          isError: true,
          text: 'faltan las dependencias del proyecto: corré `npm install` en la raíz de SMC antes de usar las tools de red.',
        };
      }
      const res = await new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => { if (!done) { done = true; resolve({ error: 'timeout (8 s)' }); } }, 8000);
        try {
          mc.ping({ host, port }, (err, r) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(err ? { error: err.message } : r);
          });
        } catch (e) {
          clearTimeout(timer);
          resolve({ error: e.message });
        }
      });
      if (res.error) return { isError: true, text: `ping falló: ${res.error}` };
      const v = res.version || {};
      const players = res.players || {};
      const lines = [
        `**${host}:${port}**`,
        `- Versión: ${v.name || '?'} (protocolo ${v.protocol ?? '?'})`,
        `- Jugadores: ${n(players.online)}/${n(players.max)}`,
        `- MOTD: ${res.description ? String(res.description.text || JSON.stringify(res.description)).slice(0, 200) : '?'}`,
      ];
      return { text: lines.join('\n') };
    },
  },
  {
    name: 'recon_readonly',
    description:
      'Corre una sesión de reconocimiento READ-ONLY contra un servidor Minecraft con cuenta propia y devuelve un digest listo para analizar. ' +
      'Exige la ventana horaria autorizada (ISO con zona horaria) y la cuenta; el bot solo hace sondeos de lectura (comandos de escritura bloqueados por diseño). ' +
      'El login se pasa como RUTA de un archivo en .secrets/, nunca como contraseña. Deja el JSON completo en out/.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Hostname o IP del servidor' },
        port: { type: 'number', description: 'Puerto (default 25565)' },
        account: { type: 'string', description: 'Cuenta con la que se conecta el bot' },
        version: { type: 'string', description: 'Versión del cliente (default auto)' },
        loginFile: { type: 'string', description: 'Ruta del archivo con la contraseña, dentro de .secrets/ del proyecto (opcional)' },
        server: { type: 'string', description: 'Backend destino detrás de un proxy (/server <nombre>), opcional' },
        windowFrom: { type: 'string', description: 'Inicio de la ventana AUTORIZADA, ISO con offset, p. ej. 2026-11-23T14:00:00-03:00' },
        windowUntil: { type: 'string', description: 'Fin de la ventana autorizada, ISO con offset' },
        maxCommands: { type: 'number', description: 'Tope de comandos del sondeo (default 30, máx 40)' },
        minIntervalMs: { type: 'number', description: 'Intervalo mínimo entre comandos (default 1200)' },
        stayMs: { type: 'number', description: 'Cuánto queda conectado tras la captura (default 5000, máx 600000)' },
      },
      required: ['host', 'account', 'windowFrom', 'windowUntil'],
    },
    handler: async (a) => {
      const host = String(a.host || '').trim();
      const port = Number(a.port || 25565);
      const account = String(a.account || '').trim();
      if (!host) return { isError: true, text: 'host vacío' };
      if (!account) return { isError: true, text: 'account vacía' };
      if (!Number.isInteger(port) || port < 1 || port > 65535) return { isError: true, text: 'puerto inválido' };
      if (!isIsoWithOffset(a.windowFrom) || !isIsoWithOffset(a.windowUntil)) {
        return {
          isError: true,
          text: 'windowFrom/windowUntil deben ser ISO con zona horaria explícita (p. ej. 2026-11-23T14:00:00-03:00). Sin una ventana autorizada no se conecta.',
        };
      }
      if (Date.parse(a.windowUntil) - Date.now() < 60000) {
        return { isError: true, text: 'la ventana autorizada ya venció o vence en menos de 1 minuto' };
      }
      let loginFile = null;
      if (a.loginFile) {
        const lf = path.resolve(String(a.loginFile));
        if (lf !== SECRETS_DIR && !lf.startsWith(SECRETS_DIR + path.sep)) {
          return { isError: true, text: `loginFile debe estar dentro de ${SECRETS_DIR}` };
        }
        if (!fs.existsSync(lf)) return { isError: true, text: `no existe ${lf}` };
        loginFile = lf;
      }
      const maxCommands = Math.min(40, Math.max(1, Number(a.maxCommands) || 30));
      const minInterval = Math.max(200, Number(a.minIntervalMs) || 1200);
      const stayMs = Math.min(600000, Math.max(0, Number(a.stayMs) || 5000));
      const outPath = path.join(OUT_DIR, `recon-${host.replace(/[^a-z0-9.-]/gi, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

      const args = [
        path.join(ROOT, 'recon.js'),
        '--host', host,
        '--port', String(port),
        '--username', account,
        '--account', account,
        '--window-from', String(a.windowFrom),
        '--window-until', String(a.windowUntil),
        '--max-commands', String(maxCommands),
        '--min-interval', String(minInterval),
        '--stay', String(stayMs),
        '--redact',
        '--out', outPath,
      ];
      if (a.version && a.version !== 'auto') args.push('--version', String(a.version));
      if (loginFile) args.push('--login-file', loginFile);
      if (a.server) args.push('--server', String(a.server));
      // Nota: NO existe ninguna forma de pasar --allow-writes desde acá.

      const res = await runScript('recon.js', args.slice(1), Math.min(600000, stayMs + 240000));
      const j = readJsonSafe(outPath);
      if (!j) {
        return {
          isError: true,
          text: `recon.js salió con código ${res.code} sin dejar JSON.\nstdout:\n${res.stdout.slice(0, 2000)}\nstderr:\n${res.stderr.slice(0, 2000)}`,
        };
      }
      const d = digest(j, { host });
      return {
        text: `${d}\n\n**JSON completo:** \`${path.relative(ROOT, outPath)}\`\n**Exit:** ${res.code}`,
      };
    },
  },
  {
    name: 'llm_digest',
    description:
      'Convierte el JSON de una (o varias) corridas de recon en un digest compacto en Markdown, pensado para analizar un servidor con poco contexto. No toca red.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Rutas de JSONs de corridas (recon/gui) dentro del proyecto',
        },
      },
      required: ['files'],
    },
    handler: async (a) => {
      const files = Array.isArray(a.files) ? a.files : [];
      if (!files.length) return { isError: true, text: 'files vacío' };
      const parts = [];
      for (const f of files.slice(0, 5)) {
        const j = readJsonSafe(f);
        if (!j) return { isError: true, text: `no pude leer ${f}` };
        parts.push(digest(j));
      }
      return { text: parts.join('\n\n---\n\n') };
    },
  },
  {
    name: 'cve_check',
    description:
      'Cruza un mapa "Plugin=versión,..." contra la base local de vulnerabilidades conocidas de plugins (tools/vulndb.json). Offline. Devuelve AFFECTED/OK/UNKNOWN por plugin.',
    inputSchema: {
      type: 'object',
      properties: {
        versions: { type: 'string', description: 'Formato: "Towny=0.103.2.15,UltraCoinFlip=6.6.2"' },
      },
      required: ['versions'],
    },
    handler: async (a) => {
      const versions = String(a.versions || '').trim();
      if (!versions) return { isError: true, text: 'versions vacío' };
      const res = await runScript('tools/cve-check.js', ['--versions', versions], 30000);
      return { isError: res.code !== 0, text: res.stdout.slice(0, 8000) || res.stderr.slice(0, 2000) };
    },
  },
  {
    name: 'reconcile_inventories',
    description:
      'Compara dos snapshots de inventario (antes/después de una prueba) y reporta deltas y stacks ilegales POR SLOT. Útil para verificar si una acción duplicó ítems. Offline.',
    inputSchema: {
      type: 'object',
      properties: {
        before: { type: 'string', description: 'Ruta del JSON con el snapshot "antes"' },
        after: { type: 'string', description: 'Ruta del JSON con el snapshot "después"' },
      },
      required: ['before', 'after'],
    },
    handler: async (a) => {
      const res = await runScript('tools/reconcile.js', [String(a.before), String(a.after)], 30000);
      return { isError: res.code !== 0, text: res.stdout.slice(0, 8000) || res.stderr.slice(0, 2000) };
    },
  },
  {
    name: 'plugin_list',
    description:
      'Genera la lista de plugins/namespaces detectados a partir del JSON de una corrida de recon. Offline.',
    inputSchema: {
      type: 'object',
      properties: {
        jsonPath: { type: 'string', description: 'Ruta del JSON de recon' },
      },
      required: ['jsonPath'],
    },
    handler: async (a) => {
      const p = path.resolve(String(a.jsonPath));
      if (!fs.existsSync(p)) return { isError: true, text: `no existe ${p}` };
      const res = await runScript('tools/plugin-list.js', [p], 60000);
      return { isError: res.code !== 0, text: res.stdout.slice(0, 8000) };
    },
  },
  {
    name: 'econ_summary',
    description:
      'Resume el dataset de precios generado por tools/shop-prices.js (top por valor, duplicados entre categorías, spreads anómalos). Offline.',
    inputSchema: {
      type: 'object',
      properties: {
        jsonPath: { type: 'string', description: 'Ruta del dataset (sky-shop-prices.json o similar)' },
      },
      required: ['jsonPath'],
    },
    handler: async (a) => {
      const p = path.resolve(String(a.jsonPath));
      if (!fs.existsSync(p)) return { isError: true, text: `no existe ${p}` };
      const res = await runScript('tools/econ-summary.js', [p], 60000);
      return { isError: res.code !== 0, text: res.stdout.slice(0, 8000) };
    },
  },
];

const n = (v) => (v == null ? '?' : v);

// ------------------------------------------------------------------ protocolo

async function callTool(id, params) {
  const name = params && params.name;
  const args = (params && params.arguments) || {};
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(id, -32602, `tool desconocida: ${name}`);
  try {
    const res = await tool.handler(args);
    ok(id, {
      content: [{ type: 'text', text: res.text }],
      ...(res.isError ? { isError: true } : {}),
    });
  } catch (e) {
    ok(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      logErr(`línea no-JSON ignorada (${line.slice(0, 80)})`);
      continue;
    }
    handleMessage(msg);
  }
});
process.stdin.on('end', () => process.exit(0));

async function handleMessage(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    ok(id, {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'smc', version: '1.0.0' },
      instructions:
        'SMC expone reconocimiento read-only de servidores Minecraft. Reglas: ' +
        '(1) solo usá recon_readonly contra servidores propios o con autorización escrita del dueño, dentro de la ventana horaria autorizada; ' +
        '(2) ninguna tool de este servidor puede escribir estado ni acepta contraseñas — el login se pasa como archivo en .secrets/; ' +
        '(3) empezá con ping_server, seguí con recon_readonly y analizá el resultado con llm_digest / plugin_list / cve_check / econ_summary. ' +
        'Las pruebas de escritura (dupe/duplicación) NO están expuestas por MCP: son solo de CLI y requieren autorización.',
    });
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'ping') {
    ok(id, {});
    return;
  }
  if (method === 'tools/list') {
    ok(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
    return;
  }
  if (method === 'tools/call') {
    await callTool(id, params);
    return;
  }
  if (id !== undefined) {
    fail(id, -32601, `método no soportado: ${method}`);
  } else {
    logErr(`notificación ignorada: ${method}`);
  }
}

logErr('servidor MCP de SMC escuchando en stdio');
