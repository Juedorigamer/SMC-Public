# SMC GUI (Electron)

Aplicación de escritorio para operar el toolkit: sesión de recon, suite de
herramientas, capa LLM y diagnóstico, con estética oscura tipo panel.

## Cómo abrirla

```bat
npm install
npm run gui
```

## Secciones

| Sección | Qué hay |
|---|---|
| **Panel / Recon** | Sesión de reconocimiento (conexión, ventana, nivel, escrituras, ViaProxy, acciones). Guard de franja del lado del main. |
| **Herramientas** | 12 tools con formulario propio (version-probe, ah-test, kit-test, packet-race, cf-test, towny-probe, llm-digest, cve-check, reconcile, plugin-list, econ-summary, informe consolidado). Salida al log y a un panel de resultado. Las tools en vivo aplican sus guardas solas: si falta ventana/cuenta/`--allow-writes`, la tool se niega a conectar y acá se ve por qué. |
| **LLM & Providers** | CRUD de providers compatibles con la API de OpenAI (`/chat/completions`): OpenAI, OpenRouter, Ollama, LM Studio… Generación del digest de una corrida (offline) y análisis del servidor por el modelo con un prompt de analista. **Las apikeys viven solo en el proceso main** (`app/providers.json`, ignorado por git); el renderer nunca las recibe. También incluye el snippet para conectar el servidor MCP a OpenCode. |
| **Skills** | Los playbooks de `skills/` en tarjetas; tocás uno y se lee acá. |
| **Diagnóstico** | Entorno (Node/Electron), dependencias, guardas (franja autorizada, allowlist de cuentas), puertos locales (lab 25599 / ViaProxy 25577), MCP y últimos archivos. |

## Guardas (resumen)

- **Ventana horaria** validada en el **proceso principal** contra
  `app/ventana-autorizada.json` (la UI no puede autorizarse a sí misma).
  Con `from/until` en `null`, ninguna sesión remota inicia.
- **Read-only por defecto**; `--allow-writes` requiere la frase de confirmación.
- **Kill switch** real: espera la muerte del árbol de procesos.
- **Instancia única**; navegación bloqueada (`setWindowOpenHandler` deny);
  el renderer solo puede abrir rutas dentro del proyecto.
- Conexiones directas a `127.0.0.1`/`localhost` (lab propio) no requieren franja.
- Logs con secretos enmascarados; `recon.js` corre siempre con `--redact`.

## Archivos

```
app/
├── main.js                  # proceso principal (IPC, spawn, guard, ViaProxy, LLM fetch)
├── preload.js               # API segura para el renderer (apikeys nunca cruzan)
├── providers.json           # providers LLM (gitignored; lo crea la UI)
├── ventana-autorizada.json  # franja autorizada (la lee SOLO el main; null = sin franja)
└── renderer/
    ├── index.html           # UI (sidebar + secciones + log dock)
    └── app.js               # lógica
```

## Pendiente

- Empaquetado con `electron-builder` para distribuir un `.exe` autónomo.
