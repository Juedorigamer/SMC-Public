'use strict';

// Renderer de la GUI. No tiene acceso a Node: todo pasa por window.api (preload).
// No maneja contraseñas: solo la ruta del archivo que lee recon.js.

const $ = (id) => document.getElementById(id);

const els = {
  host: $('host'),
  port: $('port'),
  version: $('version'),
  auth: $('auth'),
  account: $('account'),
  loginFile: $('loginFile'),
  btnPickLogin: $('btnPickLogin'),
  direct: $('direct'),
  vpStatus: $('vpStatus'),
  btnVpStart: $('btnVpStart'),
  btnVpStop: $('btnVpStop'),
  mode: $('mode'),
  modeOtro: $('modeOtro'),
  modeOtroValue: $('modeOtroValue'),
  winFrom: $('winFrom'),
  winUntil: $('winUntil'),
  sessionMins: $('sessionMins'),
  intervalSec: $('intervalSec'),
  pillWindow: $('pillWindow'),
  level: $('level'),
  aggressiveConfirm: $('aggressiveConfirm'),
  aggressiveCheck: $('aggressiveCheck'),
  aggressiveAuth: $('aggressiveAuth'),
  aggressivePhrase: $('aggressivePhrase'),
  freeze: $('freeze'),
  trace: $('trace'),
  packetLog: $('packetLog'),
  allowWrites: $('allowWrites'),
  writesConfirm: $('writesConfirm'),
  writesPhrase: $('writesPhrase'),
  btnStart: $('btnStart'),
  btnKill: $('btnKill'),
  btnReport: $('btnReport'),
  btnOpenReport: $('btnOpenReport'),
  btnOpenOut: $('btnOpenOut'),
  btnCopyLog: $('btnCopyLog'),
  btnClearLog: $('btnClearLog'),
  pillState: $('pillState'),
  pillTimer: $('pillTimer'),
  pillCount: $('pillCount'),
  pillOut: $('pillOut'),
  logs: $('logs'),
  footerOut: $('footerOut'),
};

let running = false;
let lastJson = null;
let lastReport = null;
let outDir = null;
let readyResolve;
const readyPromise = new Promise((resolve) => { readyResolve = resolve; });
let lineCount = 0;
let timerHandle = null;
let secondsLeft = 0;
let sessionTotal = 0;

// ---------------------------------------------------------------- logs

const STREAM_CLASS = {
  out: 'log-out',
  err: 'log-err',
  info: 'log-info',
  warn: 'log-warn',
  viaproxy: 'log-viaproxy',
};

function appendLog(stream, text) {
  const empty = els.logs.querySelector('.log-empty');
  if (empty) empty.remove();

  const row = document.createElement('div');
  row.className = 'log-entry ' + (STREAM_CLASS[stream] || 'log-out');

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date().toLocaleTimeString('es-AR', { hour12: false });

  const body = document.createElement('span');
  body.textContent = text;

  row.appendChild(time);
  row.appendChild(body);
  els.logs.appendChild(row);

  // Techo de 6000 líneas para no comer memoria en sesiones largas.
  if (els.logs.childElementCount > 6000) {
    els.logs.removeChild(els.logs.firstElementChild);
  }

  els.logs.scrollTop = els.logs.scrollHeight;
  lineCount++;
  els.pillCount.textContent = `Líneas: ${lineCount}`;
}

function clearLogs() {
  els.logs.innerHTML = '';
  lineCount = 0;
  els.pillCount.textContent = 'Líneas: 0';
}

// ---------------------------------------------------------------- estado

function setPill(el, text, kind) {
  el.textContent = text;
  el.className = 'pill pill-' + kind;
}

function updateWindowPill() {
  const a = parseHM(els.winFrom.value);
  const b = parseHM(els.winUntil.value);
  if (a == null || b == null) {
    setPill(els.pillWindow, 'Ventana: horario inválido', 'err');
    return false;
  }
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const ok = a <= b ? cur >= a && cur < b : cur >= a || cur < b;
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  if (ok) setPill(els.pillWindow, `Ventana: dentro (${hh}:${mm})`, 'ok');
  else setPill(els.pillWindow, `Ventana: fuera (${hh}:${mm})`, 'err');
  return ok;
}

function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function startTimer(mins) {
  stopTimer();
  sessionTotal = Math.max(1, Number(mins) || 1) * 60;
  secondsLeft = sessionTotal;
  renderTimer();
  timerHandle = setInterval(() => {
    secondsLeft = Math.max(0, secondsLeft - 1);
    renderTimer();
    if (secondsLeft === 0) stopTimer();
  }, 1000);
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function renderTimer() {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  els.pillTimer.textContent =
    `Sesión: ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (running) {
    els.pillTimer.className = 'pill pill-' + (secondsLeft < 60 ? 'warn' : 'info');
  }
}

function setRunningUI(on) {
  running = on;
  els.btnStart.disabled = on || !canStart();
  els.btnKill.disabled = !on;
  els.btnReport.disabled = on || !lastJson;
  if (!on) {
    stopTimer();
    els.pillTimer.textContent = 'Sesión: --:--';
    els.pillTimer.className = 'pill pill-muted';
  }
}

// ---------------------------------------------------------------- validaciones UI

function aggressiveReady() {
  if (els.level.value !== 'agresivo') return true;
  return (
    els.aggressiveCheck.checked &&
    els.aggressiveAuth.checked &&
    els.aggressivePhrase.value.trim().toUpperCase() === 'ACEPTÓ RIESGO DE DETECCIÓN'
  );
}

function writesReady() {
  if (!els.allowWrites.checked) return true;
  return (
    els.writesPhrase.value.trim().toUpperCase() === 'ENTIENDO QUE ESTO MODIFICA ESTADO'
  );
}

function canStart() {
  return aggressiveReady() && writesReady();
}

function refreshUI() {
  els.aggressiveConfirm.classList.toggle('hidden', els.level.value !== 'agresivo');
  els.writesConfirm.classList.toggle('hidden', !els.allowWrites.checked);
  els.modeOtro.classList.toggle('hidden', els.mode.value !== 'otro');
  updateWindowPill();
  if (!running) els.btnStart.disabled = !canStart();
}

// ---------------------------------------------------------------- acciones

function buildConfig() {
  return {
    host: els.host.value.trim(),
    port: Number(els.port.value),
    version: els.version.value,
    auth: els.auth.value,
    account: els.account.value.trim(),
    loginFile: els.loginFile.value.trim(),
    direct: els.direct.checked,
    mode: els.mode.value,
    customMode: els.modeOtroValue.value.trim(),
    winFrom: els.winFrom.value,
    winUntil: els.winUntil.value,
    sessionMins: Number(els.sessionMins.value),
    intervalSec: Number(els.intervalSec.value),
    level: els.level.value,
    aggressiveConfirmed: aggressiveReady(),
    freeze: els.freeze.checked,
    trace: els.trace.checked,
    packetLog: els.packetLog.checked,
    allowWrites: els.allowWrites.checked,
    writesPhrase: els.writesPhrase.value,
    extraProbe: window.__extraProbe || '',
    onlyExtra: Boolean(window.__onlyExtra),
    probeWait: Number(window.__probeWait || 1600),
  };
}

async function startSession() {
  if (running) return;
  if (!canStart()) {
    appendLog('err', '[gui] completá las confirmaciones requeridas antes de iniciar.');
    return;
  }
  const cfg = buildConfig();
  appendLog('info', `[gui] solicitando inicio: ${cfg.host}:${cfg.port} · modo ${cfg.mode} · nivel ${cfg.level}`);

  els.btnStart.disabled = true;
  let res;
  try {
    res = await window.api.startRecon(cfg);
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  if (!res || !res.ok) {
    appendLog('err', `[gui] no se pudo iniciar: ${(res && res.error) || 'error desconocido'}`);
    els.btnStart.disabled = false;
    return;
  }

  lastJson = res.outPath || null;
  lastReport = null;
  els.btnOpenReport.disabled = true;
  if (lastJson) {
    const name = lastJson.split(/[\\/]/).pop();
    els.pillOut.textContent = `JSON: ${name}`;
    els.pillOut.title = lastJson;
    els.footerOut.textContent = name;
  }
  setPill(els.pillState, 'En sesión', 'ok');
  setRunningUI(true);
  // El main devuelve stayMins (acotado al fin de la ventana): antes el timer
  // contaba el tiempo del input y mostraba más del que corría.
  startTimer(res.stayMins || Number(els.sessionMins.value));
  appendLog('ok', `[gui] sesión iniciada (pid ${res.pid}). JSON: ${lastJson}`);
  if (res.clamped) {
    appendLog('warn', `[gui] sesión acotada a ${res.stayMins} min por el fin de la ventana.`);
  }
}

async function killSession() {
  const res = await window.api.killRecon();
  if (res && res.ok) {
    appendLog('warn', `[gui] kill switch enviado al proceso ${res.pid}.`);
  } else {
    appendLog('warn', `[gui] ${(res && res.error) || 'no había sesión activa'}.`);
  }
}

async function generateReport() {
  if (!lastJson) {
    appendLog('warn', '[gui] todavía no hay JSON de una sesión.');
    return;
  }
  els.btnReport.disabled = true;
  let res;
  try {
    res = await window.api.generateReport();
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  els.btnReport.disabled = false;
  if (res && res.ok) {
    lastReport = res.reportPath;
    appendLog('ok', `[gui] informe generado: ${lastReport}`);
    els.footerOut.textContent = lastReport.split(/[\\/]/).pop();
    els.btnOpenReport.disabled = false;
  } else {
    appendLog('err', `[gui] no se pudo generar el informe: ${(res && res.error) || 'error'}`);
  }
}

async function startViaProxy() {
  els.btnVpStart.disabled = true;
  appendLog('info', '[viaproxy] iniciando…');
  const res = await window.api.startViaProxy({
    host: els.host.value.trim(),
    port: Number(els.port.value),
    targetVersion: els.version.value.trim() || 'auto',
  });
  els.btnVpStart.disabled = false;
  if (res && res.ok) {
    setPill(els.vpStatus, `ViaProxy: activo (pid ${res.pid})`, 'ok');
    appendLog('ok', `[viaproxy] activo en 127.0.0.1:25577 (pid ${res.pid}).`);
    els.direct.checked = false;
  } else {
    setPill(els.vpStatus, 'ViaProxy: error', 'err');
    appendLog('err', `[viaproxy] ${(res && res.error) || 'no se pudo iniciar'}`);
  }
}

async function stopViaProxy() {
  const res = await window.api.stopViaProxy();
  if (res && res.ok) {
    setPill(els.vpStatus, 'ViaProxy: detenido', 'muted');
    appendLog('info', `[viaproxy] detenido (pid ${res.pid}).`);
  } else {
    appendLog('warn', `[viaproxy] ${(res && res.error) || 'no estaba corriendo'}.`);
  }
}

// ---------------------------------------------------------------- eventos IPC

if (window.api) window.api.onLog((payload) => {
  if (!payload) return;
  appendLog(payload.stream || 'out', payload.line || '');
});

if (window.api) window.api.onStatus((st) => {
  if (!st) return;
  if (st.state === 'running') {
    setPill(els.pillState, 'En sesión', 'ok');
    return;
  }
  if (st.state === 'exit') {
    setRunningUI(false);
    if (st.outPath) {
      lastJson = st.outPath;
      els.pillOut.textContent = `JSON: ${st.outPath.split(/[\\/]/).pop()}`;
      els.pillOut.title = st.outPath;
    }
    const wasKilled = st.code == null;
    const okExit = st.code === 0;
    setPill(
      els.pillState,
      wasKilled ? 'Detenido' : okExit ? 'Terminado' : `Terminado (code ${st.code})`,
      wasKilled ? 'warn' : okExit ? 'ok' : 'warn'
    );
    els.btnReport.disabled = !lastJson;
    appendLog(okExit ? 'ok' : 'warn', `[gui] sesión finalizada (code=${st.code}).`);
    return;
  }
  if (st.state === 'error') {
    setRunningUI(false);
    setPill(els.pillState, 'Error', 'err');
    appendLog('err', `[gui] ${st.message || 'error'}`);
    return;
  }
  if (st.state === 'viaproxy') {
    if (st.running) setPill(els.vpStatus, 'ViaProxy: activo', 'ok');
    else setPill(els.vpStatus, 'ViaProxy: detenido', 'muted');
  }
});

// ---------------------------------------------------------------- wiring

els.btnStart.addEventListener('click', startSession);
els.btnKill.addEventListener('click', killSession);
els.btnReport.addEventListener('click', generateReport);
els.btnVpStart.addEventListener('click', startViaProxy);
els.btnVpStop.addEventListener('click', stopViaProxy);

els.btnOpenReport.addEventListener('click', async () => {
  if (!lastReport) return;
  const res = await window.api.openPath(lastReport);
  if (res && !res.ok) appendLog('err', `[gui] no se pudo abrir el informe: ${res.error}`);
});

els.btnPickLogin.addEventListener('click', async () => {
  try {
    const p = await window.api.pickLoginFile();
    if (p) els.loginFile.value = p;
  } catch (e) {
    appendLog('err', `[gui] no se pudo elegir el archivo: ${e.message}`);
  }
});

els.btnOpenOut.addEventListener('click', async () => {
  const target = outDir || lastJson;
  if (!target) {
    appendLog('info', '[gui] todavía no hay carpeta ni archivo para abrir.');
    return;
  }
  const res = await window.api.openPath(target);
  if (res && !res.ok) appendLog('err', `[gui] no se pudo abrir: ${res.error}`);
});

els.btnClearLog.addEventListener('click', clearLogs);
els.btnCopyLog.addEventListener('click', async () => {
  const text = els.logs.innerText;
  try {
    await navigator.clipboard.writeText(text);
    appendLog('info', '[gui] logs copiados al portapapeles.');
  } catch (e) {
    appendLog('err', `[gui] no se pudo copiar: ${e.message}`);
  }
});

[els.level, els.aggressiveCheck, els.aggressiveAuth, els.aggressivePhrase,
 els.allowWrites, els.writesPhrase, els.mode, els.winFrom, els.winUntil]
  .forEach((el) => {
    el.addEventListener('change', refreshUI);
    el.addEventListener('input', refreshUI);
  });

els.pillOut.addEventListener('click', () => {
  if (lastJson) window.api.openPath(lastJson);
});

// ---------------------------------------------------------------- autorun

// Usado por `electron . --autorun` para llenar el formulario y arrancar.
// La validación de ventana y de escritura sigue ocurriendo en el proceso principal.
window.__autorun = async (cfg) => {
  await readyPromise;
  const setVal = (el, v) => {
    if (v !== undefined && v !== null) el.value = v;
  };
  setVal(els.host, cfg.host);
  setVal(els.port, cfg.port);
  setVal(els.version, cfg.version);
  setVal(els.auth, cfg.auth);
  setVal(els.account, cfg.account);
  setVal(els.loginFile, cfg.loginFile);
  els.direct.checked = Boolean(cfg.direct);
  setVal(els.mode, cfg.mode);
  setVal(els.modeOtroValue, cfg.customMode);
  setVal(els.winFrom, cfg.winFrom);
  setVal(els.winUntil, cfg.winUntil);
  setVal(els.sessionMins, cfg.sessionMins);
  setVal(els.intervalSec, cfg.intervalSec);
  setVal(els.level, cfg.level);
  els.freeze.checked = cfg.freeze !== false;
  els.trace.checked = cfg.trace !== false;
  els.packetLog.checked = Boolean(cfg.packetLog);
  els.allowWrites.checked = Boolean(cfg.allowWrites);
  setVal(els.writesPhrase, cfg.writesPhrase || '');
  window.__extraProbe = cfg.extraProbe || '';
  window.__onlyExtra = Boolean(cfg.onlyExtra);
  window.__probeWait = Number(cfg.probeWait || 1600);
  if (cfg.aggressiveConfirmed) {
    els.aggressiveCheck.checked = true;
    els.aggressiveAuth.checked = true;
    setVal(els.aggressivePhrase, 'ACEPTÓ RIESGO DE DETECCIÓN');
  }
  refreshUI();
  await startSession();
  return { started: true };
};

// ---------------------------------------------------------------- arranque

(async () => {
  if (!window.api) {
    appendLog('err', '[gui] preload no disponible. La app no puede lanzar procesos.');
    return;
  }
  try {
    const d = await window.api.getDefaults();
    if (d) {
      outDir = d.outDir || null;
      els.host.value = d.host || els.host.value;
      els.port.value = d.port || els.port.value;
      els.version.value = d.version || 'auto';
      els.auth.value = d.auth || 'offline';
      els.account.value = d.account || els.account.value;
      els.loginFile.value = d.loginFile || '';
      els.winFrom.value = d.winFrom || '12:00';
      els.winUntil.value = d.winUntil || '13:00';
      if (d.authorizedWindowState) {
        const bad = /SIN franja|sin app/.test(d.authorizedWindowState);
        appendLog(bad ? 'warn' : 'info', `[gui] ventana autorizada: ${d.authorizedWindowState}.`);
      }
      els.sessionMins.value = d.sessionMins || 10;
      els.intervalSec.value = d.intervalSec || 5;
      if (!d.hasNode) {
        appendLog('warn', '[gui] no se encontró node\\node.exe; se usará Electron como Node.');
      }
      if (d.viaproxyRunning) {
        setPill(els.vpStatus, 'ViaProxy: activo', 'ok');
        appendLog('info', '[gui] ViaProxy ya está escuchando en 127.0.0.1:25577.');
      }
    }
    appendLog('info', '[gui] listo. Configurá y presioná “Iniciar sesión”.');
    appendLog('info', `[gui] ventana autorizada por defecto: ${els.winFrom.value}-${els.winUntil.value} (hora local).`);
  } catch (e) {
    appendLog('err', `[gui] no se pudieron cargar los valores por defecto: ${e.message}`);
  }
  refreshUI();
  const paths = await window.api.lastPaths();
  if (paths && paths.lastJson) {
    lastJson = paths.lastJson;
    els.btnReport.disabled = false;
    els.pillOut.textContent = `JSON: ${lastJson.split(/[\\/]/).pop()}`;
    els.pillOut.title = lastJson;
  }
  setInterval(updateWindowPill, 15000);
  readyResolve();
  console.log('[renderer] UI lista');
})();
