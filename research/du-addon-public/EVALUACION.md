# du-addon-public (DupersUnited) — evaluación de funcionamiento

**Repo:** `YAYLOLDEV/du-addon-public` · **Tipo:** addon **ofensivo** de Meteor Client (dúpes, crashes, utilidades).

> Descargado solo para entender la superficie de ataque del objetivo autorizado. No se ejecuta contra terceros.

## Módulos relevantes y su mecanismo

| Módulo | Clase | Mecanismo |
|---|---|---|
| **PacketDelay** | M5 (packet reorder) | Encola C2S packets seleccionados en una `LinkedList`, cancela el evento, y en `onDeactivate` los reenvía todos (`mc.getNetworkHandler().sendPacket()`). |
| **BundleDupe** | M1 + flooding | `DupeMethod` (Kick/Timeout) + `LagMethod`; interactúa con `ChestBoatEntity`/`ChestMinecartEntity`; `interact-delay-ms` (default 650). |
| **BookDupe** | M1 (save race) | Dupea el inventario con libros escribibles; "reconectar antes de dupear para guardar". Paper < 1.21.1. |
| **ShulkerDupe / TridentDupe** | vanilla viejo | 1.19 y anteriores. |
| **TradeDupe** | **AxTrade** + LF | "Adds buttons for AxTrade and LF dupe to the Sign GUI. Probably patched." |
| **AttributeSwap** | durabilidad | Intercambia slots de hotbar al atacar para conservar durabilidad. |
| **BundleCrash** | DoS | Manipula slots del bundle (1.21.4). |

## El código clave (PacketDelay, destilado)

```java
// onActivate: packets.clear();
// onPacket(Send): if (c2sPackets.contains(clazz)) { packets.add(packet); event.cancel(); }
// onDeactivate: while(!packets.isEmpty()) mc.getNetworkHandler().sendPacket(packets.poll());
```

## Implicancia para nuestra auditoría

- **PacketDelay** es **exactamente la primitiva** de la hipótesis `/cf`: encolar y soltar en ráfaga (o en orden). Como es C2S genérico, puede retrasar `ChatCommandC2SPacket` (nuestro `/cf delete`) o `ClickSlotC2SPacket` (cancel por GUI). Ya probamos 2× `/cf delete` a 0 ms y el cooldown de 3 s lo bloqueó; **queda probar el cancel por GUI** (si el menú del coinflip activo lo tiene), donde el cooldown podría no aplicarse igual.
- **TradeDupe (AxTrade)** confirma que `axtrade` del objetivo tuvo un dupe conocido por sign GUI. Ya estaba en la lista de X-Warden (`<1.10.0`). Es un lead directo, aunque "probablemente parchado".

**Veredicto:** la fuente más útil para M5; nos da el código exacto del delay y el mapeo AxTrade.
