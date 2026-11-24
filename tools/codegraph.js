// codegraph.js — grafo de código (nivel de símbolos) con acorn.
// Regenera un grafo tipo "graphify" para revisar cuántas conexiones hay.
// Uso: node tools/codegraph.js [--out graphify-out/ast-graph.json]
'use strict';

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx >= 0 && process.argv[outIdx + 1]
  ? process.argv[outIdx + 1]
  : path.join(ROOT, 'graphify-out', 'ast-graph.json');

const files = [
  'recon.js',
  'report.js',
  'mcp-server.js',
  'app/main.js',
  'app/preload.js',
  'app/renderer/app.js',
  'tools/lib/mc.js',
  'tools/llm-digest.js',
  'tools/cf-test.js',
  'tools/towny-probe.js',
  'tools/plugin-list.js',
  'tools/gen-audit-report.js',
  'tools/shop-prices.js',
  'tools/econ-summary.js',
  'tools/gen-econ-section.js',
  'tools/zipinfo.js',
  'tools/decode-windows.js',
];

function analyze(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    // falta un archivo: saltarlo con warning y seguir con el resto
    console.warn(`[!] archivo no encontrado, se omite: ${file}`);
    return { missing: true, symbols: 0, functions: 0, callEdges: 0, nodes: [], edges: [] };
  }
  const code = fs.readFileSync(full, 'utf8');
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  } catch (e) {
    return { error: e.message, symbols: 0, functions: 0, callEdges: 0, nodes: [], edges: [] };
  }

  const symbols = new Set();      // nombres de funciones + variables top-level
  const callEdges = new Set();    // "callee()" únicos (referencia a función/método)
  let functions = 0;

  function walk(node) {
    if (!node || typeof node !== 'object' || !node.type) return;
    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        functions++;
        if (node.id && node.id.name) symbols.add(node.id.name);
        break;
      case 'VariableDeclarator':
        if (node.id.type === 'Identifier') symbols.add(node.id.name);
        break;
      case 'CallExpression': {
        const c = node.callee;
        let name = null;
        if (c.type === 'Identifier') name = c.name;
        else if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') name = c.property.name;
        if (name) callEdges.add(name + '()');
        break;
      }
    }
    for (const key in node) {
      if (key === 'parent') continue;
      const v = node[key];
      if (Array.isArray(v)) { for (const c of v) if (c && c.type) walk(c); }
      else if (v && typeof v === 'object' && v.type) walk(v);
    }
  }

  walk(ast);
  return {
    symbols: symbols.size,
    functions,
    callEdges: callEdges.size,
    symbolNames: [...symbols].sort(),
    callNames: [...callEdges].sort(),
  };
}

const perFile = {};
let totalSymbols = 0, totalFunctions = 0, totalCalls = 0;
const missing = [];
for (const f of files) {
  const r = analyze(f);
  perFile[f] = r;
  if (r.missing) missing.push(f);
  totalSymbols += r.symbols || 0;
  totalFunctions += r.functions || 0;
  totalCalls += r.callEdges || 0;
}

const out = {
  tool: 'codegraph (acorn)',
  generatedAt: new Date().toISOString(),
  summary: {
    files: files.length,
    analyzed: files.length - missing.length,
    missingFiles: missing,
    totalSymbols,
    totalFunctions,
    totalCallEdges: totalCalls,
  },
  perFile,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

console.log(`archivos: ${files.length}`);
console.log(`símbolos (funciones+vars): ${totalSymbols}`);
console.log(`funciones: ${totalFunctions}`);
console.log(`conexiones (call edges únicos): ${totalCalls}`);
console.log();
console.log('--- por archivo (símbolos / funciones / calls) ---');
for (const [f, r] of Object.entries(perFile)) {
  const cells = r.missing ? '— omitido (no existe)' : `${String(r.symbols).padStart(4)} / ${String(r.functions).padStart(3)} / ${r.callEdges}`;
  console.log(`  ${f.padEnd(34)} ${cells}`);
}
console.log();
console.log('JSON: ' + OUT);
