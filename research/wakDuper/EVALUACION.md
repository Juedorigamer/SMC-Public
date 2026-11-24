# wakDuper — evaluación de funcionamiento

**Repo:** `me-jndildap/wakDuper` · **Tipo:** mod Fabric **ofensivo** (1.21.1) para explorar dupes.

> Descargado solo para entender las primitivas de ataque del objetivo autorizado.

## Primitivas (mapeadas a nuestros métodos)

| Primitiva | Mecanismo | Método |
|---|---|---|
| **Soft Close** | Cierra la GUI sin `CloseHandledScreen` → el server pierde el estado de la GUI. | M5 / M8 |
| **De-sync** | Cierra la GUI server-side pero la mantiene client-side. | M5 |
| **Send Packets (toggle)** | Deja de enviar `ClickSlot`/`ButtonClick`; todo queda client-side. | M5 |
| **Delay Packets** | Encola `ClickSlot`/`ButtonClick` y los suelta al reactivar (blink). | M5 |
| **Save UI** | Guarda la GUI y la restaura (tecla V) para reabrir sin packet. | M5/M9 |
| **Leave & Send Packets** | Suelta los paquetes encolados y **desconecta** al instante (send-and-quit). | M1 |
| **Sync Id / Revision** | Rastrea sync-id y nº de clics de la GUI → para fabricar packets. | M5/M8 |
| **GUI Chat** | Manda comandos sin salir de la GUI. | M5 |
| **PaperMC Dupe** | Dupe con libros y plumas (1.20.6–1.21.1). | M1 (viejo) |

## Evaluación

- Es el **catálogo canónico** de las primitivas de packet-delay que documentamos en `EXPLOIT-METHODS.md` (Parte 4). No aporta mecánica nueva; confirma la terminología y el uso.
- El **PaperMC Dupe** (libros) está limitado a 1.20.6–1.21.1; el objetivo es **26.3**, así que esa variante queda descartada.
- Las primitivas son client-side (Fabric); en nuestro bot las replicamos con `window_click` crudo (`research/snippets/packet-race.js`), que es el equivalente server-side.

**Veredicto:** referencia de primitivas; confirma el mapa de M5/M1, sin novedad explotable en 26.3.
