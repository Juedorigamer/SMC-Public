# Grafo de navegación — investigación de exploits

> `graphify` CLI no está disponible en este entorno; este grafo Mermaid cumple la misma función de navegación y puede abrirse en cualquier visor Mermaid (o en `research/GRAPH.html` si se renderiza).

```mermaid
flowchart LR
  subgraph DEFENSIVAS["Herramientas defensivas"]
    ES["ExploitShield<br/>(rate-limit clics, NBT, dupes)"]
    BD["BundleDupeV3Fix<br/>(clearActiveItem en quit)"]
    BAD["BetterAntiDupe<br/>(ledger de reconciliación)"]
    SD["serverdoctor<br/>(offline: log/config/perms)"]
    VB["VaultBreaker<br/>(RCON/Query/Dynmap/CVE)"]
  end

  subgraph OFENSIVOS["Herramientas ofensivas (estudio)"]
    DA["du-addon<br/>(PacketDelay, BundleDupe, TradeDupe-AxTrade)"]
    WK["wakDuper<br/>(soft-close, desync, delay, send-quit)"]
    UU["ui-utils<br/>(chat-in-GUI, delay, fabricate)"]
    PM["papermc-dupe<br/>(pickup timer desync)"]
  end

  subgraph CLASES["Clases de falla"]
    SR["save race<br/>(disconnect mid-tx)"]
    CR["confirm race<br/>(GUI de confirmación)"]
    NUM["numérico<br/>(overflow/NaN/negativo)"]
    CD["cooldown<br/>(persistencia)"]
    PR["packet reorder<br/>(blink)"]
    CB["cross-backend<br/>(save race)"]
    PB["permission bypass<br/>(CWE-862)"]
    ST["stack/quantity<br/>(edge cases)"]
    PV["preview/open<br/>(desync)"]
    RN["rounding<br/>(tax/refund)"]
    NB["NBT/custom item"]
  end

  subgraph METODOS["Métodos (M1-M11)"]
    M1["M1 disconnect-mid"]
    M2["M2 confirm race"]
    M3["M3 numérico"]
    M4["M4 cooldown"]
    M5["M5 reorder"]
    M6["M6 cross-backend"]
    M7["M7 perm bypass"]
    M8["M8 stack edge"]
    M9["M9 preview/open"]
    M10["M10 rounding"]
    M11["M11 NBT"]
  end

  subgraph PLUGINS["Plugins del objetivo"]
    AH["auctionhouse (/ah sell)"]
    CF["cf (UltraCoinFlip)"]
    KIT["cmi kits (/kitpreview)"]
    QS["quickshop (/chestshop)"]
    CRATES["excellentcrates (/cratekey)"]
    MOCH["mapumochilas (/mochilas)"]
    LOT["mapuloteria (/loteria)"]
    ORAX["oraxen"]
    DR["dailyrewards/battlepass"]
    AXT["axtrade"]
  end

  %% Herramienta -> clase que documenta/defiende
  ES --> PR
  ES --> ST
  ES --> NB
  ES --> SR
  BD --> SR
  BAD --> ST
  BAD --> SR
  VB --> CB
  VB --> NB
  SD -.fuera de alcance.-> CB

  %% Ofensiva -> clase que explota
  DA --> PR
  DA --> SR
  DA --> ST
  WK --> PR
  WK --> ST
  WK --> SR
  UU --> PR
  UU --> ST
  PM --> SR

  %% Ofensiva -> plugin objetivo con dupe conocido
  DA --> AXT

  %% Clase -> método
  SR --> M1
  SR --> M6
  CR --> M2
  NUM --> M3
  NUM --> M10
  CD --> M4
  PR --> M5
  CB --> M6
  PB --> M7
  ST --> M8
  PV --> M9
  RN --> M10
  NB --> M11

  %% Método -> plugin objetivo
  M1 --> AH
  M2 --> AH
  M3 --> AH
  M3 --> CF
  M3 --> QS
  M4 --> KIT
  M4 --> DR
  M5 --> CF
  M5 --> KIT
  M5 --> LOT
  M6 --> AH
  M7 --> CRATES
  M7 --> KIT
  M8 --> AH
  M8 --> MOCH
  M9 --> CRATES
  M10 --> CF
  M10 --> LOT
  M10 --> AH
  M11 --> ORAX
```

## Leyenda

- `-->` relación documentada en una herramienta o derivada por causa raíz.
- `-.->` relación fuera del alcance black-box (requiere archivos).
- Para cada nodo de método existe un playbook en `skills/` y, cuando aplica, un snippet en `research/snippets/`.
