// exposure-check.js — chequeo PASIVO de exposición de red (referencia, NO ejecutar sin OK).
// Equivale al nivel 'probe' de VaultBreaker: un TCP/UDP por servicio, sin flooding.
// Solo para sistemas autorizados.
'use strict';

const net = require('net');
const dgram = require('dgram');

const host = process.argv[2] || '127.0.0.1';

function tcp(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    let done = false;
    const finish = (open, info) => { if (done) return; done = true; try { s.destroy(); } catch {} resolve({ port, open, info }); };
    s.setTimeout(timeoutMs);
    s.once('connect', () => finish(true, 'abierto'));
    s.once('timeout', () => finish(false, 'timeout'));
    s.once('error', () => finish(false, 'cerrado'));
  });
}

function queryUdp(port = 25565) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const magic = Buffer.from([0xFE, 0xFD, 0x09, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    let done = false;
    const finish = (open) => { if (done) return; done = true; try { sock.close(); } catch {} resolve({ port, open }); };
    sock.on('message', () => finish(true));
    sock.on('error', () => finish(false));
    sock.send(magic, port, host);
    setTimeout(() => finish(false), 1500);
  });
}

(async () => {
  const results = [];
  results.push(await tcp(25565));   // game (ya sabemos abierto)
  results.push(await tcp(25575));   // RCON
  results.push(await queryUdp(25565)); // Query UDP
  results.push(await tcp(8123));    // Dynmap HTTP (puerto típico)
  console.log(JSON.stringify(results, null, 2));
  // Interpretación:
  // - 25575 abierto => RCON expuesto (si está habilitado).
  // - Query UDP abierto => filtra jugadores/plugins.
  // - 8123 abierto => Dynmap posiblemente público.
})();
