# BundleDupeV3Fix — evaluación de funcionamiento

**Repo:** `ruViolence/BundleDupeV3Fix` · **Tipo:** plugin defensivo mínimo (Paper).

## Qué hace

Parchea el "bundle dupe V3" (reciente, 1.21.4+/26.x), demostrado por DuperTrooper y Autism Inc.

## Código completo (3 líneas de lógica)

```java
@EventHandler(priority = EventPriority.LOWEST)
public void onPlayerQuit(PlayerQuitEvent event) {
    event.getPlayer().clearActiveItem();
}
```

## La falla que cubre (mecanismo exacto)

1. Un módulo de dupe **inunda** el pipeline Netty con paquetes excesivos → la conexión sigue "viva" pero queda **estancada**.
2. Se envía un paquete `use item` y luego un kick (o cualquier desconexión).
3. El servidor **guarda el inventario y descarga al jugador** del mundo, pero el canal Netty sigue considerado vivo y el `Connection` se sigue tickeando.
4. Durante esa ventana, el `use item` encolado se procesa: el contenido del bundle lo suelta una **entidad de jugador que ya no existe** → duplicación.

## Evaluación

- La clase es **"flood + use-item + kick"**: combina flooding (DoS) con una **race de guardado/desconexión**.
- Mapea a nuestros **M1 (disconnect-mid-transaction)** y **M5 (packet reorder)**, pero **requiere flooding**, que está **prohibido** en nuestro alcance. No se prueba; solo se documenta.
- El fix (`clearActiveItem()` en quit) es el patrón que queremos **detectar** en plugins de economía: si un plugin no limpia el estado activo al desconectar, es candidato a race de guardado.

**Veredicto:** documenta con precisión una race de desconexión moderna; sirve como plantilla para razonar sobre `M1` sin ejecutarlo.
