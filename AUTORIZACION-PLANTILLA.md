# Plantilla de autorización de auditoría

> Copiá este archivo por cada auditoría, completá los campos `[...]` y hacelo
> firmar por el dueño del servidor ANTES de cualquier conexión. Las tools de
> SMC están diseñadas para trabajar con este acuerdo: ventana horaria
> obligatoria, cuenta explícita, modo read-only por defecto y evidencia
> enmascarada.

---

## 1. Partes

| Elemento | Dato |
|---|---|
| Objetivo | `[host:puerto]` (modalidades: `[...]`) |
| Solicitante | `[quién pide la auditoría]` |
| Autorizante | **[dueño del servidor / representante con autoridad]** — confirmación del `[fecha]` por `[canal: correo/Discord/...]` |
| Cuenta de prueba | `[usuario]` (única cuenta cubierta) |
| Supervisión | `[administrador asignado para observación y rollback]` |

## 2. Franja autorizada

- **Única franja:** `[AAAA-MM-DD]`, de `[HH:MM]` a `[HH:MM]` (zona `[UTC±X]`).
- Las herramientas rechazan conectar fuera de esa franja (y la revalidan
  durante toda la corrida). Si necesitás más tiempo: **franja nueva por
  escrito**, no extensión verbal.
- En la GUI: anotá la franja en `app/ventana-autorizada.json` (`from`/`until`).

## 3. Alcance

| Modo | ¿Requiere acuerdo aparte? |
|---|---|
| Ping público (`--ping-only`) | no conecta bot; casi cero riesgo |
| Recon read-only | cubierto por esta autorización |
| **Pruebas de escritura** (`--allow-writes`, suite de duplicación) | **sí**: monto mínimo, ítems de bajo valor y rollback asignado (sección 5) |

## 4. Prohibido (siempre)

- Pruebas de carga / flooding / ráfagas (el toolkit las limita por diseño).
- Interactuar con otros jugadores: trades, compras a jugadores, subastas
  ajenas, TPAs, chat global, leaderboards.
- Tocar datos, islas, cofres o construcciones de terceros.
- Evadir captcha, anti-bot o cualquier control; **cambiar de cuenta o IP tras
  una detección es evasión** — se detiene y se reporta.
- Operar fuera de la franja.

## 5. Reglas para cada prueba de duplicación

1. **Una hipótesis por corrida.**
2. **Snapshot antes/después** (inventario, saldo, posición) — `--redact`.
3. **Relog** (o cambio de backend) antes de comparar; `tools/reconcile.js` para el diff.
4. **Reproducir** en una segunda corrida antes de declarar confirmado.
5. **Registrar el estado inicial** para rollback quirúrgico.
6. Delta no reproducible → se descarta y se documenta.
7. **Nunca** dejar duplicados en circulación: destruir o entregar al supervisor.
8. **Abortar** ante kick, alerta o comportamiento anómalo; no reintentar sin OK.

## 6. Incidentes

| Fecha | Qué pasó | Acción |
|---|---|---|
| `[fecha]` | `[detección/kick/anomalía]` | `[se detuvo la corrida / se apagó el proxy / se avisó a quién]` |

## 7. Firma

Autorizante: `[nombre]` — `[canal y fecha de la confirmación]`
Auditor: `[nombre]`
