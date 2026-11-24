'use strict';

// Renderer SMC GUI — vanilla JS, sin framework. Todo por window.api (preload).
// Este archivo no maneja apikeys: las de LLM viven solo en el main.

const $ = (id) => document.getElementById(id);

const els = {
  // topbar
  pillState: $('pillState'), pillTimer: $('pillTimer'), pillWindow: $('pillWindow'),
  vpStatus: $('vpStatus'), pillOut: $('pillOut'), pillCount: $('pillCount'), pillFoot: $('pillFoot'),
  // panel
  host: $('host'), port: $('port'), version: $('version'), auth: $('auth'), account: $('account'),
  loginFile: $('loginFile'), btnPickLogin: $('btnPickLogin'), direct: $('direct'),
  mode: $('mode'), modeOtro: $('modeOtro'), modeOtroValue: $('modeOtroValue'),
  winFrom: $('winFrom'), winUntil: $('winUntil'), sessionMins: $('sessionMins'), intervalSec: $('intervalSec'),
  level: $('level'), aggressiveConfirm: $('aggressiveConfirm'), aggressiveCheck: $('aggressiveCheck'),
  aggressiveAuth: $('aggressiveAuth'), aggressivePhrase: $('aggressivePhrase'),
  freeze: $('freeze'), trace: $('trace'), packetLog: $('packetLog'),
  allowWrites: $('allowWrites'), writesConfirm: $('writesConfirm'), writesPhrase: $('writesPhrase'),
  btnStart: $('btnStart'), btnKill: $('btnKill'), btnReport: $('btnReport'),
  btnOpenReport: $('btnOpenReport'), btnOpenOut: $('btnOpenOut'),
  btnVpStart: $('btnVpStart'), btnVpStop: $('btnVpStop'),
  // tools
  toolsGrid: $('toolsGrid'), toolResult: $('toolResult'), toolOut: $('toolOut'),
  // llm
  providersList: $('providersList'), provName: $('provName'), provModel: $('provModel'),
  provURL: $('provURL'), provKey: $('provKey'), btnProvAdd: $('btnProvAdd'), provHint: $('provHint'),
  llmProvider: $('llmProvider'), llmJson: $('llmJson'), btnLlmLast: $('btnLlmLast'),
  llmExtra: $('llmExtra'), btnDigest: $('btnDigest'), btnAnalyze: $('btnAnalyze'),
  digestOut: $('digestOut'), analysisOut: $('analysisOut'),
  // skills
  skillsGrid: $('skillsGrid'), docViewer: $('docViewer'), docTitle: $('docTitle'), docText: $('docText'),
  // diag
  btnDiag: $('btnDiag'), diagGrid: $('diagGrid'),
  // stats
  btnStats: $('btnStats'), statsHint: $('statsHint'),
  stSessions: $('stSessions'), stSessionsSub: $('stSessionsSub'),
  stCommands: $('stCommands'), stCommandsSub: $('stCommandsSub'),
  stLatency: $('stLatency'), stLatencySub: $('stLatencySub'),
  stNamespaces: $('stNamespaces'), stNamespacesSub: $('stNamespacesSub'),
  stPlugins: $('stPlugins'), stPluginsSub: $('stPluginsSub'),
  stWindows: $('stWindows'), stWindowsSub: $('stWindowsSub'),
  activityChart: $('activityChart'), stNsList: $('stNsList'), stPlList: $('stPlList'),
  // logs
  logdock: $('logdock'), logdockHead: $('logdockHead'), logs: $('logs'),
  footerOut: $('footerOut'), btnCopyLog: $('btnCopyLog'), btnClearLog: $('btnClearLog'),
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
let providers = [];

// ---------------------------------------------------------------- navegación

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    $(`view-${btn.dataset.view}`).classList.add('active');
  });
});

// ---------------------------------------------------------------- logs

const STREAM_CLASS = {
  out: 'log-out', err: 'log-err', info: 'log-info', warn: 'log-warn', viaproxy: 'log-viaproxy',
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
  if (els.logs.childElementCount > 6000) els.logs.removeChild(els.logs.firstElementChild);
  els.logs.scrollTop = els.logs.scrollHeight;
  lineCount++;
  els.pillCount.textContent = `Líneas: ${lineCount}`;
}

function clearLogs() {
  els.logs.innerHTML = '<div class="log-empty">— sin logs —</div>';
  lineCount = 0;
  els.pillCount.textContent = 'Líneas: 0';
}

els.logdockHead.addEventListener('click', () => els.logdock.classList.toggle('collapsed'));
els.btnCopyLog.addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    await navigator.clipboard.writeText(els.logs.innerText);
    appendLog('info', '[gui] logs copiados al portapapeles.');
  } catch (err) {
    appendLog('err', `[gui] no se pudo copiar: ${err.message}`);
  }
});
els.btnClearLog.addEventListener('click', (e) => { e.stopPropagation(); clearLogs(); });

// ---------------------------------------------------------------- estado / pills

function setPill(el, text, kind) {
  el.textContent = text;
  el.className = 'pill pill-' + kind;
}

function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
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
  setPill(els.pillWindow, ok ? `Ventana: dentro (${hh}:${mm})` : `Ventana: fuera (${hh}:${mm})`, ok ? 'ok' : 'err');
  return ok;
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
  els.pillTimer.textContent = `Sesión: ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (running) els.pillTimer.className = 'pill pill-' + (secondsLeft < 60 ? 'warn' : 'info');
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
  return els.writesPhrase.value.trim().toUpperCase() === 'ENTIENDO QUE ESTO MODIFICA ESTADO';
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

// ---------------------------------------------------------------- sesión

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
    targetVersion: els.version.value.trim() || 'auto',
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
  startTimer(res.stayMins || Number(els.sessionMins.value));
  appendLog('ok', `[gui] sesión iniciada (pid ${res.pid}). JSON: ${lastJson}`);
  if (res.clamped) appendLog('warn', `[gui] sesión acotada a ${res.stayMins} min por el fin de ventana.`);
}

async function killSession() {
  let res;
  try {
    res = await window.api.killRecon();
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  if (res && res.ok) appendLog('warn', `[gui] kill switch: terminando proceso ${res.pid} y sus hijos.`);
  else appendLog('warn', `[gui] ${(res && res.error) || 'no había sesión activa'}.`);
}

async function generateReport() {
  if (!lastJson) return;
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
  let res;
  try {
    res = await window.api.startViaProxy({
      host: els.host.value.trim(),
      port: Number(els.port.value),
      targetVersion: els.version.value.trim() || 'auto',
    });
  } catch (e) {
    res = { ok: false, error: e.message };
  }
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
  let res;
  try {
    res = await window.api.stopViaProxy();
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  if (res && res.ok) {
    setPill(els.vpStatus, 'ViaProxy: detenido', 'muted');
    appendLog('info', `[viaproxy] detenido (pid ${res.pid}).`);
  } else {
    appendLog('warn', `[viaproxy] ${(res && res.error) || 'no estaba corriendo'}.`);
  }
}

// ---------------------------------------------------------------- IPC eventos

if (window.api) window.api.onLog((payload) => {
  if (!payload) return;
  appendLog(payload.stream || 'out', payload.line || '');
});

if (window.api) window.api.onStatus((st) => {
  if (!st) return;
  els.pillFoot.textContent = st.state || '';
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

// ---------------------------------------------------------------- wiring panel

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

els.pillOut.addEventListener('click', () => {
  if (lastJson) window.api.openPath(lastJson);
});

[els.level, els.aggressiveCheck, els.aggressiveAuth, els.aggressivePhrase,
 els.allowWrites, els.writesPhrase, els.mode, els.winFrom, els.winUntil]
  .forEach((el) => {
    el.addEventListener('change', refreshUI);
    el.addEventListener('input', refreshUI);
  });

// ---------------------------------------------------------------- HERRAMIENTAS

const ISO_PH = '2026-11-24T14:00:00-03:00';

// Parámetros de sesión comunes para tools en vivo.
const SESSION_PARAMS = [
  { id: 'account', label: 'Cuenta', ph: 'MiAuditora', def: 'MiAuditora' },
  { id: 'loginFile', label: 'Login file', ph: '.secrets/miauditora.txt', def: '' },
  { id: 'windowFrom', label: 'Ventana desde (ISO+TZ)', ph: ISO_PH, def: '' },
  { id: 'windowUntil', label: 'Ventana hasta (ISO+TZ)', ph: ISO_PH, def: '' },
];

const TOOLS = [
  {
    script: 'version-probe.js', name: 'Version probe', tags: ['ro'],
    desc: 'Recolecta versiones de plugins con comandos whitelisted read-only (/towny version, /cf info…). Deja out/versions-*.json para cve-check.',
    params: SESSION_PARAMS,
    build: (v) => args(['--account', v.account, '--login-file', v.loginFile, '--window-from', v.windowFrom, '--window-until', v.windowUntil, '--out', out('versions')]),
  },
  {
    script: 'ah-test.js', name: 'Auction House (M1/M3)', tags: ['w'],
    desc: 'check (read-only), nan/negative (abuso numérico en /ah sell) y list-leave (dupe por desconexión a mitad).',
    params: [
      { id: 'mode', label: 'Modo', type: 'select', options: ['check', 'nan', 'negative', 'list-leave'] },
      { id: 'price', label: 'Precio', ph: '1' },
      { id: 'leaveAfter', label: 'leave-after (ms)', ph: '400' },
      ...SESSION_PARAMS,
      { id: 'allowWrites', label: '--allow-writes (autorización vigente)', type: 'check' },
    ],
    build: (v) => args([
      '--mode', v.mode, '--price', v.price || '1',
      ...(v.leaveAfter ? ['--leave-after', v.leaveAfter] : []),
      '--account', v.account, '--login-file', v.loginFile,
      '--window-from', v.windowFrom, '--window-until', v.windowUntil,
      ...(v.allowWrites ? ['--allow-writes'] : []),
      '--out', out('ah'),
    ]),
  },
  {
    script: 'kit-test.js', name: 'Kit cooldown (M4)', tags: ['w'],
    desc: 'Reclama un kit, hace relog (o flip de backend SIN relog) y reclama otra vez: mide si el cooldown se salta.',
    params: [
      { id: 'relogMode', label: 'Modo', type: 'select', options: ['relog', 'backend'] },
      { id: 'kitSlot', label: 'Slot del kit', ph: '19' },
      { id: 'item', label: 'Ítem esperado', ph: 'bread' },
      ...SESSION_PARAMS,
      { id: 'allowWrites', label: '--allow-writes (autorización vigente)', type: 'check' },
    ],
    build: (v) => args([
      '--relog-mode', v.relogMode, '--kit-slot', v.kitSlot || '19',
      ...(v.item ? ['--item', v.item] : []),
      '--account', v.account, '--login-file', v.loginFile,
      '--window-from', v.windowFrom, '--window-until', v.windowUntil,
      ...(v.allowWrites ? ['--allow-writes'] : []),
      '--out', out('kit'),
    ]),
  },
  {
    script: 'packet-race.js', name: 'Packet race (M5)', tags: ['w'],
    desc: 'Clics crudos con delay/reorden en una GUI (máx. 4, sin flooding). Usa los campos reales del protocolo.',
    params: [
      { id: 'open', label: 'GUI a abrir', ph: '/cf' },
      { id: 'clicks', label: 'Clics slot:button:mode:delayMs', ph: '22:1:0:0,22:1:0:80' },
      { id: 'reorder', label: '--reorder', type: 'check' },
      { id: 'flushQuit', label: '--flush-then-quit', type: 'check' },
      ...SESSION_PARAMS,
      { id: 'allowWrites', label: '--allow-writes (autorización vigente)', type: 'check' },
    ],
    build: (v) => args([
      '--open', v.open, '--clicks', v.clicks,
      ...(v.reorder ? ['--reorder'] : []), ...(v.flushQuit ? ['--flush-then-quit'] : []),
      '--account', v.account, '--login-file', v.loginFile,
      '--window-from', v.windowFrom, '--window-until', v.windowUntil,
      ...(v.allowWrites ? ['--allow-writes'] : []),
      '--out', out('race'),
    ]),
  },
  {
    script: 'cf-test.js', name: 'Coinflip (reembolso doble)', tags: ['w'],
    desc: 'Crea un coinflip PRIVADO (verificado), doble delete con delay y compara saldos incluida la lectura tardía.',
    params: [
      { id: 'amount', label: 'Monto', ph: '100' },
      { id: 'delay', label: 'Delay delete (ms)', ph: '100' },
      ...SESSION_PARAMS,
      { id: 'allowWrites', label: '--allow-writes (autorización vigente)', type: 'check' },
    ],
    build: (v) => args([
      '--amount', v.amount || '100', '--delay', v.delay || '100',
      '--account', v.account, '--login-file', v.loginFile,
      '--window-from', v.windowFrom, '--window-until', v.windowUntil,
      ...(v.allowWrites ? ['--allow-writes'] : []),
      '--out', out('cf'),
    ]),
  },
  {
    script: 'towny-probe.js', name: 'Sonda Towny', tags: ['ro'],
    desc: 'Diagnóstico de la fase de configuración de Towny (resource pack, freeze, rebote). Solo lectura.',
    params: [
      { id: 'packMode', label: 'Pack mode', type: 'select', options: ['accept', 'native', 'accept-instant', 'decline', 'none'] },
      { id: 'server', label: 'Backend', ph: 'towny' },
      ...SESSION_PARAMS,
    ],
    build: (v) => args([
      '--pack-mode', v.packMode, ...(v.server ? ['--server', v.server] : []),
      '--account', v.account, '--login-file', v.loginFile,
      '--window-from', v.windowFrom, '--window-until', v.windowUntil,
      '--out', out('towny-diag'),
    ]),
  },
  {
    script: 'llm-digest.js', name: 'LLM digest', tags: ['ro'],
    desc: 'Condensa el JSON de una corrida en un digest compacto para contexto de LLM. Offline.',
    params: [{ id: 'json', label: 'JSON de corrida', ph: 'out/recon-….json' }],
    build: (v) => [v.json],
  },
  {
    script: 'cve-check.js', name: 'CVE check', tags: ['ro'],
    desc: 'Cruza "Plugin=versión,…" contra la base local. Offline. Marca AFFECTED/OK/UNKNOWN con confianza.',
    params: [
      { id: 'versions', label: 'Versiones', ph: 'Towny=0.103.2.15,QuickShop=6.2.0.9' },
      { id: 'from', label: 'o JSON de version-probe', ph: 'out/versions-….json' },
    ],
    build: (v) => (v.versions ? ['--versions', v.versions] : ['--from', v.from]),
  },
  {
    script: 'reconcile.js', name: 'Reconcile', tags: ['ro'],
    desc: 'Diff de dos snapshots de inventario: deltas y stacks ilegales POR SLOT. Offline.',
    params: [
      { id: 'before', label: 'Antes (JSON)', ph: 'out/antes.json' },
      { id: 'after', label: 'Después (JSON)', ph: 'out/despues.json' },
    ],
    build: (v) => [v.before, v.after],
  },
  {
    script: 'plugin-list.js', name: 'Plugin list', tags: ['ro'],
    desc: 'Tabla de plugins/namespaces desde el JSON de una corrida. Offline.',
    params: [{ id: 'json', label: 'JSON de corrida', ph: 'out/recon-….json' }],
    build: (v) => [v.json],
  },
  {
    script: 'econ-summary.js', name: 'Econ summary', tags: ['ro'],
    desc: 'Resumen del dataset de precios (top de ventas, duplicados, spreads anómalos). Offline.',
    params: [{ id: 'json', label: 'Dataset de precios', ph: 'out/sky-shop-prices.json' }],
    build: (v) => [v.json],
  },
  {
    script: 'gen-audit-report.js', name: 'Informe consolidado', tags: ['ro'],
    desc: 'Une barrido + corridas de /cf + lista de plugins en un informe Markdown. Tolerante a archivos faltantes.',
    params: [
      { id: 'sweep', label: 'Sweep (JSON)', ph: 'out/recon-….json' },
      { id: 'cf', label: 'cf-test (JSON, separados por coma)', ph: 'out/cf-01.json' },
      { id: 'plugins', label: 'plugins .md', ph: 'out/plugins-….md' },
      { id: 'host', label: 'Host (título)', ph: 'mc.ejemplo.com' },
    ],
    build: (v) => args([
      '--sweep', v.sweep, ...(v.cf ? ['--cf', v.cf] : []), ...(v.plugins ? ['--plugins', v.plugins] : []),
      ...(v.host ? ['--host', v.host] : []), '--out', out('informe-auditoria', 'md'),
    ]),
  },
];

function args(list) {
  return list.filter((x) => x !== undefined && x !== null && String(x) !== '');
}
function out(prefix, ext = 'json') {
  return `out/${prefix}-${Date.now()}.${ext}`;
}

function renderTools() {
  els.toolsGrid.innerHTML = '';
  for (const t of TOOLS) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    const h = document.createElement('h4');
    h.textContent = `${t.name} `;
    const code = document.createElement('code');
    code.textContent = `tools/${t.script}`;
    h.appendChild(code);
    card.appendChild(h);
    const p = document.createElement('p');
    p.textContent = t.desc;
    card.appendChild(p);

    const argBox = document.createElement('div');
    argBox.className = 'tool-args';
    const values = {};
    for (const prm of t.params) {
      values[prm.id] = prm.def || '';
      const f = document.createElement('div');
      f.className = 'field';
      const lab = document.createElement('label');
      lab.textContent = prm.label;
      f.appendChild(lab);
      let input;
      if (prm.type === 'select') {
        input = document.createElement('select');
        for (const o of prm.options) {
          const op = document.createElement('option');
          op.value = o;
          op.textContent = o;
          input.appendChild(op);
        }
      } else if (prm.type === 'check') {
        input = document.createElement('input');
        input.type = 'checkbox';
        f.className = 'field';
        f.replaceChildren(lab, input);
        input.addEventListener('change', () => { values[prm.id] = input.checked; });
        argBox.appendChild(f);
        continue;
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = prm.ph || '';
      }
      if (prm.def) input.value = prm.def;
      input.addEventListener('input', () => { values[prm.id] = input.value; });
      if (prm.type === 'select') values[prm.id] = prm.options[0];
      f.appendChild(input);
      argBox.appendChild(f);
    }
    card.appendChild(argBox);

    const foot = document.createElement('div');
    foot.className = 'tool-foot';
    const run = document.createElement('button');
    run.className = 'btn btn-sm';
    run.textContent = 'Ejecutar';
    run.addEventListener('click', async () => {
      run.disabled = true;
      const res = await window.api.runTool({ tool: t.script, args: t.build(values) });
      run.disabled = false;
      if (res && res.ok) {
        els.toolResult.classList.remove('hidden');
        els.toolOut.textContent = (res.output || '').slice(0, 20000) || '(sin salida)';
        appendLog('ok', `[tool] ${t.script} terminó (code 0).`);
      } else {
        const msg = (res && res.error) || `salió con código ${res && res.code}`;
        els.toolResult.classList.remove('hidden');
        els.toolOut.textContent = `✖ ${msg}\n(revisá el log: las guardas explican por qué)`;
        appendLog('err', `[tool] ${t.script}: ${msg}`);
      }
    });
    foot.appendChild(run);
    for (const tag of t.tags) {
      const tg = document.createElement('span');
      tg.className = 'tag' + (tag === 'w' ? ' w' : ' ro');
      tg.textContent = tag === 'w' ? 'escribe (guardas)' : 'read-only';
      foot.appendChild(tg);
    }
    card.appendChild(foot);
    els.toolsGrid.appendChild(card);
  }
}

// ---------------------------------------------------------------- LLM & PROVIDERS

function renderProviders() {
  els.providersList.innerHTML = '';
  if (!providers.length) {
    els.providersList.innerHTML = '<span class="hint">Sin providers configurados.</span>';
    return;
  }
  for (const p of providers) {
    const row = document.createElement('div');
    row.className = 'prov-item';
    const b = document.createElement('b');
    b.textContent = p.name;
    const sp = document.createElement('span');
    sp.textContent = `${p.model} · ${p.baseURL} · ${p.hasKey ? '🔑 key' : 'sin key'}`;
    const del = document.createElement('button');
    del.className = 'btn btn-sm';
    del.textContent = 'Quitar';
    del.addEventListener('click', async () => {
      providers = providers.filter((x) => x.id !== p.id);
      await saveProviders();
    });
    row.appendChild(b);
    row.appendChild(sp);
    row.appendChild(del);
    els.providersList.appendChild(row);
  }
  const sel = els.llmProvider;
  sel.innerHTML = '';
  for (const p of providers) {
    const op = document.createElement('option');
    op.value = p.id;
    op.textContent = `${p.name} (${p.model})`;
    sel.appendChild(op);
  }
}

async function saveProviders() {
  const res = await window.api.llmProvidersSave(
    providers.map((p) => ({ id: p.id, name: p.name, baseURL: p.baseURL, model: p.model, apiKey: p.apiKey || '' }))
  );
  if (res && res.ok) {
    els.provHint.textContent = `guardado (${res.count} provider/s)`;
    await loadProviders();
  } else {
    els.provHint.textContent = (res && res.error) || 'error al guardar';
    appendLog('err', `[llm] ${res && res.error}`);
  }
}

async function loadProviders() {
  try {
    providers = (await window.api.llmProviders()) || [];
  } catch {
    providers = [];
  }
  renderProviders();
}

els.btnProvAdd.addEventListener('click', async () => {
  const name = els.provName.value.trim();
  const baseURL = els.provURL.value.trim();
  const model = els.provModel.value.trim();
  const apiKey = els.provKey.value.trim();
  if (!name || !baseURL || !model) {
    els.provHint.textContent = 'faltan campos (nombre, base URL y modelo)';
    return;
  }
  const existing = providers.find((p) => p.name === name);
  if (existing) {
    existing.baseURL = baseURL;
    existing.model = model;
    existing.apiKey = apiKey || existing.apiKey || '';
  } else {
    providers.push({ id: `p${Date.now()}`, name, baseURL, model, apiKey });
  }
  els.provKey.value = '';
  await saveProviders();
});

els.btnLlmLast.addEventListener('click', async () => {
  const paths = await window.api.lastPaths();
  if (paths && paths.lastJson) els.llmJson.value = paths.lastJson;
  else appendLog('info', '[llm] todavía no hay un JSON de sesión en esta corrida de la GUI.');
});

els.btnDigest.addEventListener('click', async () => {
  const p = els.llmJson.value.trim();
  if (!p) {
    appendLog('err', '[llm] indicá la ruta del JSON de la corrida.');
    return;
  }
  els.digestOut.textContent = 'generando…';
  const res = await window.api.llmDigest(p);
  if (res && res.ok) {
    els.digestOut.textContent = res.digest;
    appendLog('ok', '[llm] digest listo.');
  } else {
    els.digestOut.textContent = `✖ ${(res && res.error) || 'error'}`;
    appendLog('err', `[llm] ${res && res.error}`);
  }
});

els.btnAnalyze.addEventListener('click', async () => {
  const providerId = els.llmProvider.value;
  const jsonPath = els.llmJson.value.trim();
  if (!providerId) {
    appendLog('err', '[llm] configurá primero un provider.');
    return;
  }
  if (!jsonPath) {
    appendLog('err', '[llm] indicá la ruta del JSON de la corrida.');
    return;
  }
  els.btnAnalyze.disabled = true;
  els.analysisOut.textContent = 'consultando al modelo (hasta 3 min)…';
  appendLog('info', `[llm] analizando ${jsonPath} con ${providerId}`);
  let res;
  try {
    res = await window.api.llmAnalyze({ providerId, jsonPath, extraPrompt: els.llmExtra.value });
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  els.btnAnalyze.disabled = false;
  if (res && res.ok) {
    els.digestOut.textContent = res.digest;
    els.analysisOut.textContent = res.analysis;
    appendLog('ok', '[llm] análisis listo.');
  } else {
    els.analysisOut.textContent = `✖ ${(res && res.error) || 'error'}`;
    appendLog('err', `[llm] ${res && res.error}`);
  }
});

// ---------------------------------------------------------------- SKILLS

async function loadSkills() {
  const res = await window.api.listSkills();
  els.skillsGrid.innerHTML = '';
  if (!res || !res.ok || !res.skills.length) {
    els.skillsGrid.innerHTML = '<div class="card"><span class="hint">No se encontraron skills.</span></div>';
    return;
  }
  for (const s of res.skills) {
    const card = document.createElement('div');
    card.className = 'card skill-card';
    const h = document.createElement('h3');
    h.textContent = s.name;
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = s.summary || '';
    card.appendChild(h);
    card.appendChild(p);
    card.addEventListener('click', async () => {
      const doc = await window.api.readDoc(`skills/${s.file}`);
      if (doc && doc.ok) {
        els.docViewer.classList.remove('hidden');
        els.docTitle.textContent = s.file;
        els.docText.textContent = doc.text;
        els.docViewer.scrollIntoView({ behavior: 'smooth' });
      } else {
        appendLog('err', `[skills] ${doc && doc.error}`);
      }
    });
    els.skillsGrid.appendChild(card);
  }
}

// ---------------------------------------------------------------- DIAGNOSTICO

function diagRow(label, value, cls) {
  const item = document.createElement('div');
  item.className = 'diag-item';
  const s = document.createElement('span');
  s.textContent = label;
  const b = document.createElement('b');
  b.className = cls || '';
  b.textContent = value;
  item.appendChild(s);
  item.appendChild(b);
  return item;
}

function diagCard(title, rows) {
  const card = document.createElement('div');
  card.className = 'card';
  const h = document.createElement('h3');
  h.textContent = title;
  card.appendChild(h);
  rows.forEach((r) => card.appendChild(r));
  return card;
}

function yn(ok) {
  return ok ? 'OK' : 'FALTA';
}

els.btnDiag.addEventListener('click', async () => {
  els.btnDiag.disabled = true;
  const d = await window.api.runDiag();
  els.btnDiag.disabled = false;
  if (!d) return;
  els.diagGrid.innerHTML = '';

  els.diagGrid.appendChild(diagCard('Entorno', [
    diagRow('Node', d.node, 'ok'),
    diagRow('Electron', d.electron, 'ok'),
  ]));

  els.diagGrid.appendChild(diagCard('Dependencias', [
    diagRow('mineflayer (npm install)', yn(d.deps.mineflayer), d.deps.mineflayer ? 'ok' : 'err'),
    diagRow('electron', yn(d.deps.electronApp), d.deps.electronApp ? 'ok' : 'err'),
    diagRow('ViaProxy jar (tools/viaproxy)', yn(d.deps.viaproxy), d.deps.viaproxy ? 'ok' : 'warn'),
  ]));

  els.diagGrid.appendChild(diagCard('Guardas', [
    diagRow('Franja autorizada (GUI)', d.guards.window, d.guards.window.includes('franja vigente') ? 'ok' : 'warn'),
    diagRow('Allowlist de cuentas (tools/lib/accounts.txt)', d.guards.accounts.exists ? `configurada (${d.guards.accounts.count})` : 'sin configurar (cualquier cuenta no vacía pasa)', d.guards.accounts.exists ? 'ok' : 'warn'),
  ]));

  els.diagGrid.appendChild(diagCard('Puertos locales', [
    diagRow('Lab (127.0.0.1:25599)', d.ports.lab ? 'arriba' : 'caído', d.ports.lab ? 'ok' : ''),
    diagRow('ViaProxy (127.0.0.1:25577)', d.ports.viaproxy ? 'arriba' : 'caído', d.ports.viaproxy ? 'ok' : ''),
  ]));

  els.diagGrid.appendChild(diagCard('MCP', [
    diagRow('mcp-server.js', yn(d.mcp.file), d.mcp.file ? 'ok' : 'err'),
    diagRow('Comando', d.mcp.command, 'ok'),
  ]));

  const lastCard = diagCard('Últimos archivos', [
    diagRow('JSON', d.last.lastJson ? d.last.lastJson.split(/[\\/]/).pop() : '—'),
    diagRow('Informe', d.last.lastReport ? d.last.lastReport.split(/[\\/]/).pop() : '—'),
  ]);
  els.diagGrid.appendChild(lastCard);

  setPill(els.vpStatus, d.ports.viaproxy ? 'ViaProxy: activo' : 'ViaProxy: caído', d.ports.viaproxy ? 'ok' : 'muted');
});

// ---------------------------------------------------------------- ESTADISTICAS

function renderChips(container, list) {
  container.innerHTML = '';
  if (!list || !list.length) {
    container.innerHTML = '<span class="hint">sin datos todavía</span>';
    return;
  }
  const shown = list.slice(0, 40);
  for (const name of shown) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = name;
    container.appendChild(chip);
  }
  if (list.length > shown.length) {
    const more = document.createElement('span');
    more.className = 'chip more';
    more.textContent = `+${list.length - shown.length} más`;
    container.appendChild(more);
  }
}

function renderStats(s) {
  els.stSessions.textContent = s.sessions.total;
  els.stSessionsSub.textContent = s.sessions.total
    ? `${s.sessions.readOnly} read-only · ${s.sessions.withWrites} con escrituras · ${s.sessions.aborted} abortadas${s.sessions.lastAt ? ` · última: ${s.sessions.lastAt.slice(0, 16).replace('T', ' ')} (${s.sessions.lastHost || '?'})` : ''}`
    : 'sin corridas en out/';

  els.stCommands.textContent = s.commands.sent;
  els.stCommandsSub.textContent = s.commands.sent || s.commands.blocked
    ? `${s.commands.blocked} bloqueados por el guard (${s.commands.blockRatio}%)`
    : '—';

  els.stLatency.textContent = s.latency.avgMs != null ? `${s.latency.avgMs} ms` : '—';
  els.stLatencySub.textContent = s.latency.count
    ? `max ${s.latency.maxMs} ms · ${s.latency.count} mediciones`
    : 'sin mediciones';

  els.stNamespaces.textContent = s.surface.namespaces;
  els.stNamespacesSub.textContent = `${s.surface.commandsSeen} comandos visibles acumulados`;
  els.stPlugins.textContent = s.surface.plugins;
  els.stPluginsSub.textContent = `${s.files.scanned} JSON/s escaneado/s · ${s.files.skipped} ignorado/s`;
  els.stWindows.textContent = s.surface.windows;
  els.stWindowsSub.textContent = `${s.surface.packs} resource packs ofrecidos · ${s.errors.count} avisos/errores`;

  // barras: últimos 14 días
  els.activityChart.innerHTML = '';
  const max = Math.max(1, ...s.activity.map((a) => a.count));
  for (const a of s.activity) {
    const bar = document.createElement('div');
    bar.className = 'bar' + (a.count ? '' : ' zero');
    bar.style.height = `${Math.max(2, Math.round((a.count / max) * 100))}%`;
    const tip = document.createElement('span');
    tip.className = 'tip';
    tip.textContent = `${a.date}: ${a.count}`;
    bar.appendChild(tip);
    bar.title = `${a.date}: ${a.count} corrida/s`;
    els.activityChart.appendChild(bar);
  }

  renderChips(els.stNsList, s.surface.namespacesList);
  renderChips(els.stPlList, s.surface.pluginsList);

  els.statsHint.textContent = `calculado sobre out/ · ${new Date().toLocaleTimeString('es-AR', { hour12: false })}`;
}

async function loadStats() {
  try {
    const res = await window.api.collectStats();
    if (res && res.ok) {
      renderStats(res.stats);
      return true;
    }
    appendLog('err', `[stats] ${res && res.error}`);
  } catch (e) {
    appendLog('err', `[stats] ${e.message}`);
  }
  return false;
}

els.btnStats.addEventListener('click', loadStats);

// refrescar stats al entrar a la sección
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'stats') loadStats();
  });
});

// ---------------------------------------------------------------- autorun (CLI --autorun)

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
  renderTools();
  loadSkills();
  loadProviders();
  loadStats();
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
      els.sessionMins.value = d.sessionMins || 10;
      els.intervalSec.value = d.intervalSec || 5;
      if (!d.hasNode) appendLog('warn', '[gui] no se encontró node portable; se usará Electron como Node.');
      if (d.viaproxyRunning) {
        setPill(els.vpStatus, 'ViaProxy: activo', 'ok');
        appendLog('info', '[gui] ViaProxy ya está escuchando en 127.0.0.1:25577.');
      }
      if (d.authorizedWindowState) {
        const bad = /SIN franja|sin app/.test(d.authorizedWindowState);
        appendLog(bad ? 'warn' : 'info', `[gui] ventana autorizada: ${d.authorizedWindowState}.`);
        els.pillFoot.textContent = bad ? 'sin franja' : 'franja vigente';
      }
    }
    appendLog('info', '[gui] listo. Elegí una sección y configurá la sesión.');
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
  console.log('[renderer] UI SMC lista');
})();
