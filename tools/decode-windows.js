#!/usr/bin/env node
'use strict';

// Decodifica los componentes de item guardados por recon.js (formato NBT
// "anonymous" de minecraft-protocol) a texto legible. Uso:
//   node tools/decode-windows.js <json> [--all]
// Sin --all solo muestra los items con custom_name/lore.

const fs = require('fs');

function listText(node) {
  // node = { type: <elemType>, value: [ ... ] } (formato lista de prismarine-nbt)
  if (!node || !node.value) return '';
  const elems = node.value;
  if (!Array.isArray(elems)) return '';
  // lore: cada elemento es una línea; sin separador se pegaban entre sí
  return elems.map((e) => text(e)).join(' · ');
}

function text(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node !== 'object') return String(node);

  // Nodo con envoltura { type, value }
  if (node.type && Object.prototype.hasOwnProperty.call(node, 'value')) {
    switch (node.type) {
      case 'string':
        return Array.isArray(node.value) ? node.value.join('') : String(node.value);
      case 'list':
        return listText(node.value);
      case 'compound':
        return text(node.value);
      default:
        return '';
    }
  }

  // Compuesto plano: es un componente de chat de Minecraft
  let s = '';
  if (node.text != null) s += typeof node.text === 'string' ? node.text : text(node.text);
  if (node.translate != null && !s) s += typeof node.translate === 'string' ? node.translate : '';
  if (node.extra != null) s += text(node.extra);
  if (node.with != null) s += text(node.with);
  return s;
}

function componentValue(components, name) {
  for (const c of components || []) {
    let type;
    let data;
    if (typeof c === 'string') {
      const i = c.indexOf(':');
      if (i < 0) continue;
      type = c.slice(0, i);
      const raw = c.slice(i + 1);
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
    } else if (c) {
      type = c.type || c.name;
      data = c.data;
    } else {
      continue;
    }
    if (type !== name) continue;
    return data;
  }
  return null;
}

const file = process.argv[2];
const all = process.argv.includes('--all');
if (!file) {
  console.error('uso: decode-windows.js <json> [--all]');
  process.exit(1);
}

let j;
try {
  j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
  console.error(`[!] ${file} no es JSON válido: ${e.message}`);
  process.exit(2);
}
for (const w of j.windows || []) {
  const slots = w.slots || [];
  console.log(`=== ventana cmd=${w.cmd || '-'} type=${w.type} slots=${slots.length}`);
  for (const s of slots) {
    const cn = componentValue(s.components, 'custom_name');
    const lore = componentValue(s.components, 'lore');
    const cd = componentValue(s.components, 'custom_data');
    const name = cn ? text(cn).trim() : '';
    const loreLines = lore
      ? (Array.isArray(lore) ? lore : [lore]).map((x) => text(x).trim()).filter(Boolean)
      : [];
    if (!all && !name && !loreLines.length && !cd) continue;
    const hotbar = cd && cd.hotbarItem ? cd.hotbarItem.value || cd.hotbarItem : null;
    console.log(
      `${String(s.slot).padStart(2)} ${s.id} x${s.count}` +
        (name ? ` | ${name}` : '') +
        (hotbar ? ` | hotbar=${hotbar}` : '') +
        (loreLines.length ? `\n     ${loreLines.join(' / ')}` : '')
    );
  }
}
