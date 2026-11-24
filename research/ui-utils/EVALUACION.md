# UI-Utils (original) — evaluación de funcionamiento

**Repo:** `Coderx-Gamer/ui-utils` (el `UI-Utils-Reborn` de `florianreuth` está **archivado/eliminado**; este es el original citado en su README).
**Tipo:** mod Fabric **ofensivo** de depuración de GUIs.

> Nota: `florianreuth/UI-Utils-Reborn` devuelve 404 al clonar. Se descargó el original.

## Primitivas (del README y `HandledScreenMixin`)

| Botón | Mecanismo | Método |
|---|---|---|
| **Close without packet** | Cierra la GUI sin `CloseHandledScreenC2SPacket`. | M5 / M8 |
| **De-sync** | Cierra server-side, mantiene client-side. | M5 |
| **Send packets: true/false** | Bloquea `ClickSlotC2SPacket` y `ButtonClickC2SPacket`. | M5 |
| **Delay packets** | Guarda todos los `ClickSlot`/`ButtonClick` en una lista y los envía **todos juntos** al desactivar. | M5 |
| **Save GUI** | Guarda el `ScreenHandler` y lo restaura con una tecla. | M5 / M9 |
| **Disconnect and send packets** | Envía la lista y **desconecta inmediatamente**. | M1 |
| **Sync Id / Revision** | Números internos de sincronización de la GUI. | M5 |
| **Fabricate packet** | Crea un `ClickSlotC2SPacket`/`ButtonClickC2SPacket` custom con sync-id/revision arbitrarios. | M5 / M8 |

## Código clave

`HandledScreenMixin.init()` inyecta un **chat field dentro de la GUI**: si el texto empieza con `/`, llama `sendChatCommand()` sin cerrar la ventana. Esto es lo que permite **mandar un comando mientras la GUI sigue abierta** — combinado con `Delay packets`, es la base de la hipótesis `/cf` (comando + clic en el mismo estado).

## Evaluación

- Confirma que **"fabricate packet"** permite mandar un clic con sync-id/revision **arbitrarios**: ese es el vector para clics sobre contenedores cerrados/stale (M8).
- El **chat-in-GUI** + `Delay packets` es la combinación que habilita "mandar `/cf delete` y el clic de cancelar en el mismo tick".
- Igual que `wakDuper`, son primitivas **client-side**; en el bot se replican con `window_click` crudo y `bot.chat` sin cambio de estado.

**Veredicto:** referencia de M5/M8; aporta el detalle del chat-in-GUI y del packet fabricado.
