# Skill — Packet delay (reorden / soft-close / send-and-quit)

**Método:** M5 · **Herramienta:** `research/snippets/packet-race.js`

## Primitivas (lado cliente)

| Primitiva | Efecto |
|---|---|
| **Delay/blink** | Encolar `ClickSlot`/`ButtonClick` y soltarlos después o en otro orden. |
| **Soft close** | Cerrar la GUI sin `CloseHandledScreen` → el server cree que seguís adentro. |
| **Desync** | Cerrar GUI del lado server, mantenerla del cliente. |
| **Send-and-quit** | Soltar los clics encolados y desconectar al instante. |
| **Fabricate packet** | `ClickSlot` con sync-id/revision arbitrarios. |

## Cómo lo implementamos (sin flooding)

El bot usa `bot._client.write('window_click', {...})` crudo, con control de delay, orden y flush opcional + quit.

- `--clicks <slot:button:mode:delayMs,...>`
- `--reorder` (encolar y soltar en orden inverso)
- `--flush-then-quit` (soltar y desconectar)

## Mecanismo exacto (del código ofensivo descargado)

- **`du-addon/PacketDelay`**: cola `LinkedList<Packet>` + `onPacketSend` cancela y encola; `onDeactivate` hace `while(!empty) handler.sendPacket(poll())` → **todos juntos**.
- **`ui-utils`**: inyecta un **chat field dentro de la GUI** (`sendChatCommand` sin cerrar la ventana) y **fabricate packet** (clic con sync-id/revision arbitrarios).
- **`wakDuper`**: soft-close, desync, delay, send-and-quit, save-GUI.

Ver `research/snippets/packet-delay-queue.java`.

## Límites estrictos

- **Máximo 4 clics** por corrida. El umbral defensivo típico es 80 clics/900 ms (ExploitShield) — nos mantenemos muy por debajo.
- **Sin flooding** (prohibido por alcance).
- Una hipótesis por corrida; snapshot + relog + reproducción.

## Referencia

- `ExploitShield/ClickWindowListener` (rate-limit de clics).
- `BundleDupeV3Fix` (flood + use-item + kick; documentado, no probado).
- `du-addon-public`, `wakDuper`, `ui-utils` (primitivas descargadas y evaluadas).
