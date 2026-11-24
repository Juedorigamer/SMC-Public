'use strict';

// SMC GUI — proceso principal de Electron.
//
// Responsabilidades:
//  - Crear la ventana y cargar el renderer.
//  - Validar la ventana horaria autorizada (autoridad final, no el renderer).
//  - Lanzar recon.js como proceso hijo y transmitir stdout/stderr en vivo.
//  - Kill switch: matar el árbol de procesos del hijo.
//  - Lanzar/detener ViaProxy local.
//  - Generar el informe Markdown desde el JSON de salida.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const ROOT = path.join(__dirname, '..');
const NODE_BIN = path.join(ROOT, 'node', 'node.exe');
const RECON = path.join(ROOT, 'recon.js');
const REPORT = path.join(ROOT, 'report.js');
const VP_JAR = path.join(ROOT, 'tools', 'viaproxy', 'ViaProxy-3.4.14.jar');
const OUT_DIR = path.join(ROOT, 'out');
// Fuente de verdad de la franja autorizada, del lado del MAIN: la UI solo la
// muestra. from/until en null = "sin franja vigente" y ninguna sesión remota
// puede iniciar. La UI autodeclarada ya no basta.
const AUTH_WINDOW_FILE = path.join(__dirname, 'ventana-autorizada.json');

let win = null;
let reconChild = null;
let vpChild = null;
let lastJson = null;
let lastReport = null;

// Una sola instancia: dos ventanas lanzaban dos sesiones simultáneas (justo
// lo que el guard quiere impedir) y dos ViaProxy.
if (!app.requestSingleInstanceLock()) {
  console.log('[gui] ya hay una instancia corriendo; esta se cierra.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// ---------------------------------------------------------------- utilidades

function nodeCommand() {
  // En desarrollo usamos el Node portátil del proyecto. Si no existe,
  // Electron puede actuar como Node con ELECTRON_RUN_AS_NODE=1.
  if (fs.existsSync(NODE_BIN)) return { cmd: NODE_BIN, env: {} };
  return { cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(mi) || h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function minutesNow() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function windowCheck(from, until) {
  const a = parseHM(from);
  const b = parseHM(until);
  if (a == null || b == null) return { ok: false, reason: 'Horario inválido (usar HH:MM)' };
  const now = minutesNow();
  const ok = a <= b ? now >= a && now < b : now >= a || now < b;
  const hh = String(Math.floor(now / 60)).padStart(2, '0');
  const mm = String(now % 60).padStart(2, '0');
  return {
    ok,
    reason: ok ? null : `Fuera de la ventana ${from}-${until} (hora local ${hh}:${mm})`,
  };
}

function remainingMinutes(until) {
  const b = parseHM(until);
  if (b == null) return 0;
  const now = minutesNow();
  return b >= now ? b - now : 24 * 60 - now + b;
}

function isoFromLocalHM(hhmm, addDay = false) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (addDay) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function checkPort(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function redact(line) {
  return String(line)
    .replace(/(\/(?:login|log|l|register|reg)\s*)\S+/gi, '$1****')
    .replace(/^(\/(?:login|log|l|register|reg)\s*).*$/i, '$1****');
}

function sendLog(stream, line) {
  // La máscara también aplica a la consola: con --autorun la línea cruda iba
  // sin redact (y una redirección la dejaba en disco).
  const safe = redact(line);
  if (process.argv.includes('--autorun')) console.log(`[${stream}] ${safe}`);
  if (!win || win.isDestroyed()) return;
  win.webContents.send('recon:log', {
    stream,
    line: safe,
    at: new Date().toISOString(),
  });
}

function sendStatus(status) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('recon:status', status);
}

function lineSplitter(stream) {
  // StringDecoder: decodificar por chunk cortaba caracteres multibyte y el
  // chat con acentos salía con U+FFFD.
  const dec = new StringDecoder('utf8');
  let buf = '';
  return (chunk) => {
    buf += dec.write(chunk);
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line) sendLog(stream, line);
    }
  };
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    // Sin este listener, un taskkill ausente lanzaba un 'error' sin handler
    // y MATABA el proceso principal, dejando a recon/ViaProxy huérfanos.
    tk.on('error', () => {
      try { child.kill('SIGKILL'); } catch { /* ya muerto */ }
    });
    tk.on('exit', () => {
      // taskkill falló silenciosamente (p. ej. permisos): fallback.
      if (child.exitCode == null && !child.killed) {
        try { child.kill('SIGKILL'); } catch { /* ya muerto */ }
      }
    });
  } catch {
    try { child.kill('SIGKILL'); } catch { /* ya muerto */ }
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Lee la franja autorizada del archivo que la UI no puede escribir.
// - {missing:true}  no hay archivo
// - {none:true}     hay archivo pero sin franja vigente (from/until null)
// - {from, until}   franja vigente
function authorizedWindow() {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(AUTH_WINDOW_FILE, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return { missing: true };
  }
  const a = parseHM(j && j.from);
  const b = parseHM(j && j.until);
  if (a == null || b == null) return { none: true };
  return { from: String(j.from), until: String(j.until) };
}

// ---------------------------------------------------------------- ventana

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#0b0c10',
    title: 'SMC GUI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // El preload solo usa contextBridge/ipcRenderer: sandbox puede quedar
      // activo (antes false sin necesidad).
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Bloqueo de navegación: sin esto, un link arrastrado o un window.open
  // reinyectaba el preload en contenido no confiable con window.api expuesto
  // (spawn de procesos, kill switch, openPath) = cadena completa de RCE.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('console-message', (...args) => {
    // Electron cambió la firma de este evento entre versiones.
    const details = args[1];
    const msg = details && typeof details === 'object' ? details.message : args[2];
    if (msg) console.log(`[renderer] ${msg}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer] fallo de carga ${code} ${desc} ${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[renderer] proceso terminado: ${details && details.reason}`);
  });
  // Autotest opcional: verifica preload + validación de ventana sin abrir nada.
  // La ventana 23:59-23:59 es SIEMPRE inválida (from == until nunca contiene
  // la hora actual): el selftest debe recibir el rechazo y nunca lanzar una
  // sesión real (antes, corrido dentro de la franja, spawneaba de verdad).
  if (process.argv.includes('--selftest')) {
    win.webContents.once('did-finish-load', async () => {
      try {
        const res = await win.webContents.executeJavaScript(`(async () => {
          const cfg = {
            host: '127.0.0.1', port: 25565, version: 'auto', auth: 'offline',
            account: 'selftest', loginFile: '', direct: true, mode: 'lobby',
            customMode: '', winFrom: '23:59', winUntil: '23:59',
            sessionMins: 1, intervalSec: 5, level: 'minimo',
            aggressiveConfirmed: true, freeze: true, trace: false,
            packetLog: false, allowWrites: false, writesPhrase: ''
          };
          return await window.api.startRecon(cfg);
        })()`);
        console.log('[selftest]', JSON.stringify(res), '(se esperaba ok:false por cuenta sin autorizar)');
      } catch (e) {
        console.error('[selftest] error', e.message);
      }
      setTimeout(() => app.quit(), 600);
    });
  }
  // Autorun: carga app/autorun.json y arranca la sesión en la UI.
  if (process.argv.includes('--autorun')) {
    win.webContents.once('did-finish-load', async () => {
      try {
        const cfgPath = path.join(__dirname, 'autorun.json');
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        // La ruta del secreto y la frase de confirmación no van al log plano
        // (antes el volcado completo dejaba la ubicación de .secrets en disco).
        const safeCfg = { ...cfg };
        delete safeCfg.loginFile;
        delete safeCfg.writesPhrase;
        console.log('[autorun] config:', JSON.stringify(safeCfg));
        const res = await win.webContents.executeJavaScript(
          `window.__autorun(${JSON.stringify(cfg)})`
        );
        console.log('[autorun] resultado:', JSON.stringify(res));
      } catch (e) {
        console.error('[autorun] error', e.message);
      }
    });
  }
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  killTree(reconChild);
  killTree(vpChild);
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  killTree(reconChild);
  killTree(vpChild);
});

// ---------------------------------------------------------------- IPC

ipcMain.handle('app:defaults', async () => {
  const loginFile = path.join(ROOT, '.secrets', 'auditor.txt');
  const auth = authorizedWindow();
  return {
    root: ROOT,
    outDir: OUT_DIR,
    host: '127.0.0.1',
    port: 25599,
    version: 'auto',
    auth: 'offline',
    account: 'Auditor',
    loginFile: fs.existsSync(loginFile) ? loginFile : '',
    // La UI muestra la franja del archivo autorizado (si existe).
    winFrom: auth && !auth.missing && !auth.none ? auth.from : '12:00',
    winUntil: auth && !auth.missing && !auth.none ? auth.until : '13:00',
    authorizedWindowState:
      auth.none ? 'SIN franja autorizada vigente: ninguna sesión remota puede iniciar'
      : auth.missing ? 'sin app/ventana-autorizada.json'
      : 'franja vigente del archivo autorizado',
    sessionMins: 10,
    intervalSec: 5,
    viaproxyJar: VP_JAR,
    viaproxyRunning: await checkPort('127.0.0.1', 25577, 400),
    nodeBin: NODE_BIN,
    hasNode: fs.existsSync(NODE_BIN),
  };
});

ipcMain.handle('dialog:loginFile', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Elegir archivo con la contraseña',
    defaultPath: path.join(ROOT, '.secrets'),
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('shell:openPath', async (_e, p) => {
  if (!p) return { ok: false, error: 'ruta vacía' };
  // El renderer solo puede abrir rutas DENTRO del proyecto: en Windows
  // shell.openPath EJECUTA .exe/.bat/.cmd, así que un parámetro libre era una
  // primitiva de "ejecutar archivo arbitrario" expuesta al renderer.
  const resolved = path.resolve(String(p));
  const rootResolved = path.resolve(ROOT);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return { ok: false, error: `ruta fuera del proyecto (bloqueada): ${p}` };
  }
  if (!fs.existsSync(resolved)) return { ok: false, error: `no existe: ${resolved}` };
  const err = await shell.openPath(resolved);
  return err ? { ok: false, error: err } : { ok: true };
});

// ---------------------------------------------------------------- recon

ipcMain.handle('recon:start', async (_e, cfg) => {
  if (reconChild) return { ok: false, error: 'Ya hay una sesión en curso.' };

  // El selftest debe VERIFICAR el IPC, nunca lanzar una sesión real.
  if (String(cfg.account || '') === 'selftest') {
    return { ok: false, error: 'selftest: inicio bloqueado a propósito (el canal IPC responde).' };
  }

  if (cfg.level === 'agresivo' && !cfg.aggressiveConfirmed) {
    return { ok: false, error: 'El nivel agresivo requiere la doble verificación.' };
  }

  let allowWrites = false;
  if (cfg.allowWrites) {
    if (String(cfg.writesPhrase || '').trim().toUpperCase() !== 'ENTIENDO QUE ESTO MODIFICA ESTADO') {
      return { ok: false, error: 'La frase de confirmación de escritura no coincide.' };
    }
    allowWrites = true;
  }

  const direct = Boolean(cfg.direct);
  let host = String(cfg.host || '').trim();
  let port = Number(cfg.port || 25565);
  let version = String(cfg.version || 'auto');

  if (!direct) {
    host = '127.0.0.1';
    port = 25577;
    version = '26.1';
    const up = await checkPort('127.0.0.1', 25577);
    if (!up) {
      const msg = 'ViaProxy no está escuchando en 127.0.0.1:25577. Inicialo antes de conectar.';
      sendLog('err', `[gui] ${msg}`);
      return { ok: false, error: msg };
    }
  }

  if (!host) return { ok: false, error: 'Host vacío.' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Puerto inválido.' };

  // Objetivo LOCAL (lab propio, directo sin proxy): no requiere franja
  // autorizada. Vía ViaProxy SIEMPRE es producción (el proxy existe para eso).
  const isLocalTarget = direct && /^(localhost|127(?:\.\d{1,3}){3}|::1)$/i.test(host);

  // ---- Franja autorizada: la autoridad es el archivo del main, no la UI ----
  // Antes la ventana se validaba contra los <input> editables del renderer:
  // quien quisiera correr a las 4 AM cambiaba los campos y el main validaba
  // la ventana contra sí misma.
  let winFrom = String(cfg.winFrom || '');
  let winUntil = String(cfg.winUntil || '');
  if (isLocalTarget) {
    sendLog('info', '[gui] objetivo local (lab): sin requisito de ventana autorizada.');
  } else {
    const auth = authorizedWindow();
    if (auth.missing) {
      const msg = `No existe ${AUTH_WINDOW_FILE}: sin fuente autorizada de franja, ninguna sesión remota inicia. Crealo con from/until (HH:MM) cuando haya autorización vigente.`;
      sendLog('err', `[gui] ${msg}`);
      return { ok: false, error: msg };
    }
    if (auth.none) {
      const msg = 'No hay ventana autorizada vigente: ninguna sesión remota puede iniciar. Definí from/until en app/ventana-autorizada.json cuando haya autorización escrita.';
      sendLog('err', `[gui] ${msg}`);
      return { ok: false, error: msg };
    }
    winFrom = auth.from;
    winUntil = auth.until;
    if (String(cfg.winFrom || '') !== winFrom || String(cfg.winUntil || '') !== winUntil) {
      sendLog('warn', `[gui] la franja de la UI no coincide con la autorizada: se usa la del archivo (${winFrom}-${winUntil}).`);
    }
  }

  const winCheck = windowCheck(winFrom, winUntil);
  if (!winCheck.ok) {
    sendLog('err', `[gui] ${winCheck.reason}`);
    return { ok: false, error: winCheck.reason };
  }

  const account = String(cfg.account || '').trim();
  if (!account) return { ok: false, error: 'Cuenta vacía.' };

  // El nombre del backend entra al nombre del archivo de salida: sin sanitizar,
  // un customMode "../../x" escribía el JSON fuera de out/ (path traversal).
  const rawMode = cfg.mode === 'otro' ? String(cfg.customMode || '').trim() : String(cfg.mode || '');
  const mode = rawMode.replace(/[^\w.-]+/g, '_').replace(/^[-.]+/, '');
  if (cfg.mode === 'otro' && !mode) return { ok: false, error: 'Especificá el nombre del backend.' };

  // El archivo de login solo puede estar en .secrets/ del proyecto: antes el
  // renderer apuntaba --login-file a cualquier ruta legible.
  if (cfg.loginFile) {
    const lf = path.resolve(String(cfg.loginFile));
    const secretsDir = path.resolve(path.join(ROOT, '.secrets'));
    if (lf !== secretsDir && !lf.startsWith(secretsDir + path.sep)) {
      return { ok: false, error: 'El archivo de login debe estar dentro de .secrets/ del proyecto.' };
    }
    if (!fs.existsSync(lf)) return { ok: false, error: `No existe ${lf}` };
  }

  // Acotar la sesión al tiempo restante de la ventana (con 1 min de margen).
  const remaining = isLocalTarget ? 24 * 60 : remainingMinutes(winUntil);
  let stayMs = Math.max(1, Number(cfg.sessionMins || 10)) * 60000;
  const maxMs = Math.max(0, remaining * 60000 - 60000);
  let clamped = false;
  if (stayMs > maxMs) {
    stayMs = maxMs;
    clamped = true;
  }
  if (stayMs < 30000) {
    const msg = 'Queda menos de ~1 minuto de ventana; no se inicia la sesión.';
    sendLog('warn', `[gui] ${msg}`);
    return { ok: false, error: msg };
  }

  const outPath = path.join(OUT_DIR, `gui-${stamp()}-${mode || 'lobby'}.json`);
  if (path.dirname(path.resolve(outPath)) !== path.resolve(OUT_DIR)) {
    return { ok: false, error: 'Nombre de backend inválido (carpeta de salida inesperada).' };
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const fromMin = parseHM(winFrom);
  const untilMin = parseHM(winUntil);
  const overnight = fromMin != null && untilMin != null && untilMin <= fromMin;
  // Objetivo local: ventana sintética siempre vigente (no dependemos de los
  // campos de hora de la UI, que podrían ser basura y romperían toISOString).
  const fromISO = isLocalTarget ? new Date(Date.now() - 3600000).toISOString() : isoFromLocalHM(winFrom, false);
  const untilISO = isLocalTarget ? new Date(Date.now() + stayMs + 900000).toISOString() : isoFromLocalHM(winUntil, overnight);

  const args = [
    RECON,
    '--host', host,
    '--port', String(port),
    '--username', account,
    '--auth', String(cfg.auth || 'offline'),
    '--account', account,
    '--window-from', fromISO,
    '--window-until', untilISO,
    '--min-interval', String(Math.max(1, Number(cfg.intervalSec || 5)) * 1000),
    '--wait', '5000',
    '--stay', String(stayMs),
    '--out', outPath,
    '--redact',
  ];

  if (version && version !== 'auto') args.push('--version', version);
  if (cfg.loginFile) args.push('--login-file', String(cfg.loginFile));

  if (cfg.level === 'minimo') {
    args.push('--no-probe', '--no-tab');
  } else {
    if (cfg.mode === 'towny') args.push('--profile', 'towny');
    if (cfg.level === 'agresivo') {
      args.push('--extra-probe', '/money|/baltop|/warps|/spawn|/shop|/ah');
    }
  }

  if (cfg.trace) args.push('--trace');
  if (cfg.packetLog) args.push('--packet-log');
  if (cfg.extraProbe) args.push('--extra-probe', String(cfg.extraProbe));
  if (cfg.onlyExtra) args.push('--only-extra');
  if (cfg.probeWait) args.push('--probe-wait', String(cfg.probeWait));

  if (mode && mode !== 'lobby') args.push('--server', mode);
  if (cfg.freeze) args.push('--freeze');
  if (allowWrites) args.push('--allow-writes');

  const node = nodeCommand();
  sendLog('info', `[gui] iniciando: ${node.cmd} ${args.slice(1).join(' ')}`);
  if (clamped) {
    sendLog('warn', `[gui] sesión acotada a ${Math.round(stayMs / 60000)} min por el fin de ventana.`);
  }

  try {
    reconChild = spawn(node.cmd, args, {
      cwd: ROOT,
      env: { ...process.env, ...node.env },
      windowsHide: true,
    });
  } catch (e) {
    reconChild = null;
    const msg = `No se pudo lanzar recon.js: ${e.message}`;
    sendLog('err', `[gui] ${msg}`);
    return { ok: false, error: msg };
  }

  lastJson = outPath;
  lastReport = null;

  reconChild.stdout.on('data', lineSplitter('out'));
  reconChild.stderr.on('data', lineSplitter('err'));

  reconChild.on('error', (e) => {
    reconChild = null;
    sendLog('err', `[gui] error del proceso: ${e.message}`);
    sendStatus({ state: 'error', message: e.message, outPath });
  });

  reconChild.on('exit', (code, signal) => {
    reconChild = null;
    sendLog('info', `[gui] proceso terminado (code=${code}, signal=${signal || 'none'})`);
    sendStatus({ state: 'exit', code, signal, outPath });
  });

  sendStatus({ state: 'running', pid: reconChild.pid, outPath });
  return { ok: true, pid: reconChild.pid, outPath, clamped, stayMins: Math.round(stayMs / 60000) };
});

ipcMain.handle('recon:kill', async () => {
  if (!reconChild) return { ok: false, error: 'No hay sesión activa.' };
  const pid = reconChild.pid;
  sendLog('warn', `[gui] kill switch: terminando proceso ${pid} y sus hijos.`);
  // Resuelve recién cuando el árbol murió: antes respondía ok al instante y,
  // si taskkill fallaba, la UI decía "terminado" y la sesión quedaba colgada
  // ("Ya hay una sesión en curso" para siempre).
  await new Promise((resolve) => {
    let settled = false;
    const fin = () => { if (settled) return; settled = true; resolve(); };
    reconChild.once('exit', fin);
    reconChild.once('error', fin);
    killTree(reconChild);
    setTimeout(fin, 5000);
  });
  return { ok: true, pid };
});

// ---------------------------------------------------------------- viaproxy

ipcMain.handle('viaproxy:start', async (_e, cfg) => {
  if (vpChild) return { ok: false, error: 'ViaProxy ya está corriendo.' };
  if (!fs.existsSync(VP_JAR)) return { ok: false, error: `No existe ${VP_JAR}` };

  const host = String(cfg.host || 'mc.ejemplo.com').trim();
  const port = Number(cfg.port || 25565);
  if (!host) return { ok: false, error: 'Host vacío.' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Puerto inválido.' };
  // Versión objetivo del backend: configurable. 'auto' deja que ViaProxy la
  // detecte solo; si el backend corre una versión que el cliente no habla,
  // fijala explícitamente (p. ej. la que devolvió el ping del servidor).
  const targetVersion = String(cfg.targetVersion || cfg.version || 'auto').trim() || 'auto';
  const args = [
    '-jar', VP_JAR, 'cli',
    '--bind-address', '127.0.0.1:25577',
    '--target-address', `${host}:${port}`,
    '--target-version', targetVersion,
    '--proxy-online-mode', 'false',
    '--auth-method', 'NONE',
    '--fake-accept-resource-packs', 'true',
    '--log-ips', 'false',
    '--connect-timeout', '15000',
  ];

  try {
    vpChild = spawn('java', args, { cwd: path.dirname(VP_JAR), windowsHide: true });
  } catch (e) {
    vpChild = null;
    return { ok: false, error: `No se pudo lanzar Java: ${e.message}` };
  }

  vpChild.stdout.on('data', lineSplitter('viaproxy'));
  vpChild.stderr.on('data', lineSplitter('viaproxy'));
  vpChild.on('error', (e) => {
    sendLog('err', `[viaproxy] ${e.message}`);
    sendStatus({ state: 'viaproxy', running: false, error: e.message });
  });
  vpChild.on('exit', (code) => {
    vpChild = null;
    sendLog('info', `[viaproxy] terminado (code=${code})`);
    sendStatus({ state: 'viaproxy', running: false, code });
  });

  // Esperar a que abra el puerto (hasta 20 s).
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await checkPort('127.0.0.1', 25577, 400)) {
      sendStatus({ state: 'viaproxy', running: true, pid: vpChild.pid });
      return { ok: true, pid: vpChild.pid };
    }
    if (!vpChild) break;
  }
  // Si no abrió, no dejamos el proceso colgado.
  if (vpChild) {
    killTree(vpChild);
    vpChild = null;
  }
  return { ok: false, error: 'ViaProxy no abrió el puerto 25577 a tiempo.' };
});

ipcMain.handle('viaproxy:stop', async () => {
  if (!vpChild) return { ok: false, error: 'ViaProxy no está corriendo.' };
  const pid = vpChild.pid;
  sendLog('info', `[viaproxy] deteniendo (pid ${pid})...`);
  await new Promise((resolve) => {
    let settled = false;
    const fin = () => { if (settled) return; settled = true; resolve(); };
    vpChild.once('exit', fin);
    vpChild.once('error', fin);
    killTree(vpChild);
    setTimeout(fin, 5000);
  });
  return { ok: true, pid };
});

// ---------------------------------------------------------------- informe

ipcMain.handle('report:generate', async () => {
  if (!lastJson || !fs.existsSync(lastJson)) {
    return { ok: false, error: 'Todavía no hay un JSON de esta sesión.' };
  }
  const node = nodeCommand();
  const args = [REPORT, lastJson, '--tag', 'gui'];
  sendLog('info', `[gui] generando informe: ${lastJson}`);

  return await new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(node.cmd, args, {
        cwd: ROOT,
        env: { ...process.env, ...node.env },
        windowsHide: true,
      });
    } catch (e) {
      return resolve({ ok: false, error: `No se pudo lanzar report.js: ${e.message}` });
    }
    // Tope de 60 s: si report.js cuelga, el invoke queda colgado y el botón
    // "Informe" quedaba disabled para siempre.
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ya muerto */ }
      done({ ok: false, error: 'report.js no terminó en 60 s (timeout).' });
    }, 60000);

    const dec = new StringDecoder('utf8');
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += dec.write(d);
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (line) {
          out += line + '\n';
          sendLog('out', line);
        }
      }
    });
    child.stderr.on('data', (d) => {
      d.toString('utf8').split(/\r?\n/).filter(Boolean).forEach((l) => sendLog('err', l));
    });
    child.on('error', (e) => done({ ok: false, error: e.message }));
    child.on('exit', (code) => {
      if (code !== 0) return done({ ok: false, error: `report.js salió con código ${code}` });
      const m = /Informe generado:\s*(.+)/.exec(out);
      if (m) {
        lastReport = m[1].trim();
        return done({ ok: true, reportPath: lastReport });
      }
      done({ ok: false, error: 'No se pudo detectar la ruta del informe.' });
    });
  });
});

ipcMain.handle('app:lastPaths', async () => ({ lastJson, lastReport }));
