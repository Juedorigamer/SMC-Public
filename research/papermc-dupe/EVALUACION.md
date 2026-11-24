# papermc-dupe — evaluación de funcionamiento

**Repo:** `mrbreaknfix/papermc-dupe` · **Tipo:** mod Fabric **ofensivo** (exploit Paper).

## Mecanismo (del README)

> "By exploiting an oversight in the paper server software, we are able to **desync the client and server's item pickup timers**, resulting in a race condition that happens to duplicate your items when you join back."

## Clase

- **Drop/pickup race + rejoin** → el item se duplica al reconectar porque el cliente y el servidor tienen timers de pickup desincronizados.
- Es una variante de **M1** (disconnect-mid-transaction), pero sobre el **pickup de ítems en el mundo** en vez de un contenedor/plugin.

## Evaluación

- Aplica a **dupes vanilla/Paper de mundo** (soltar ítems, reconectar antes de que el server confirme el pickup), no a plugins de economía.
- **Requiere** soltar ítems en el mundo y timing de rejoin — en Towny el PvP protegido y el mundo compartido lo hacen arriesgado (los ítems pueden ser tomados por otros → interacción con terceros).
- Versión de Paper específica; el objetivo usa **Leaf 26.3.build.13-alpha** (fork de Paper). Si ese fork no incluye el parche de pickup, sería explotable; pero probarlo implica soltar ítems y reconectar rápido, rozando la interacción con terceros y el timing.

**Veredicto:** clase de race de mundo (M1), de bajo valor para una auditoría de economía/plugins y con riesgo de interacción; se documenta, no se prueba.
