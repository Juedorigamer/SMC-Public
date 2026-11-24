#!/usr/bin/env node
'use strict';

// Lector mínimo de ZIP (sin dependencias): lista entradas y extrae archivos.
// Uso:
//   node tools/zipinfo.js <zip>                 lista todo
//   node tools/zipinfo.js <zip> --extract <p>   extrae un archivo a stdout
//   node tools/zipinfo.js <zip> --summary       resumen por namespace

const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
const mode = process.argv[3];
const arg = process.argv[4];

if (!file) {
  console.error('uso: zipinfo.js <zip> [--extract <path>] [--summary]');
  process.exit(1);
}

let buf;
try {
  buf = fs.readFileSync(file);
} catch (err) {
  if (err.code === 'ENOENT') console.error(`[!] archivo no encontrado: ${file}`);
  else console.error(`[!] no pude leer ${file}: ${err.message}`);
  process.exit(1);
}

// End of Central Directory: firma 0x06054b50, se busca desde el final.
let eocd = -1;
for (let i = buf.length - 22; i >= 0 && i >= buf.length - 66000; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) {
    eocd = i;
    break;
  }
}
if (eocd < 0) {
  console.error('no es un zip válido (sin EOCD)');
  process.exit(1);
}

const count = buf.readUInt16LE(eocd + 10);
let off = buf.readUInt32LE(eocd + 16);
const entries = [];

for (let i = 0; i < count; i++) {
  if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) {
    console.error(`central directory corrupto en entrada ${i}`);
    break;
  }
  const method = buf.readUInt16LE(off + 10);
  const compSize = buf.readUInt32LE(off + 20);
  const uncompSize = buf.readUInt32LE(off + 24);
  const nameLen = buf.readUInt16LE(off + 28);
  const extraLen = buf.readUInt16LE(off + 30);
  const commentLen = buf.readUInt16LE(off + 32);
  const localOff = buf.readUInt32LE(off + 42);
  const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
  entries.push({ name, method, compSize, uncompSize, localOff });
  off += 46 + nameLen + extraLen + commentLen;
}

function extract(entry) {
  const lo = entry.localOff;
  if (!(lo >= 0) || lo + 30 > buf.length) throw new Error(`local header fuera de rango (offset ${lo})`);
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('local header inválido');
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  // validar límites ANTES del slice (buf.slice fuera de rango tira RangeError crudo)
  if (lo + 30 + nameLen + extraLen + entry.compSize > buf.length) {
    throw new Error(`datos truncos (fin ${start + entry.compSize} > tamaño del zip ${buf.length})`);
  }
  const data = buf.slice(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`método de compresión ${entry.method} no soportado`);
}

if (mode === '--extract') {
  const e = entries.find((x) => x.name === arg);
  if (!e) {
    console.error(`no existe: ${arg}`);
    process.exit(1);
  }
  try {
    process.stdout.write(extract(e));
    process.exit(0);
  } catch (err) {
    // error por entrada: mensaje corto y seguir sin stack crudo
    console.error(`${e.name}: ERROR ${err.message}`);
    process.exit(1);
  }
}

if (mode === '--summary') {
  const byNs = new Map();
  for (const e of entries) {
    const parts = e.name.split('/');
    const key = parts[0] === 'assets' && parts[1] ? `assets/${parts[1]}` : parts[0] + '/';
    byNs.set(key, (byNs.get(key) || 0) + 1);
  }
  console.log(`entradas: ${entries.length}, bytes: ${buf.length}`);
  for (const [k, n] of [...byNs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(`${String(n).padStart(6)}  ${k}`);
  }
  process.exit(0);
}

for (const e of entries) console.log(`${e.uncompSize}\t${e.method}\t${e.name}`);
