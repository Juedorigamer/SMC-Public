# Índice de navegación — investigación de exploits

**Raz:** research/ del proyecto SMC

## 1. Defensas (documentan qué se bloquea y con qué umbral)

| Carpeta | Tipo | Aplicable black-box | Evaluación |
|---|---|---|---|
| `ExploitShield/` | Plugin defensivo (paquetes/NBT/dupes) | ✅ (referencia de defensas) | `ExploitShield/EVALUACION.md` |
| `BundleDupeV3Fix/` | Parche del bundle dupe | ✅ (documenta race) | `BundleDupeV3Fix/EVALUACION.md` |
| `BetterAntiDupe/` | Detector forense (ledger) | ✅ (valida reconcile) | `BetterAntiDupe/EVALUACION.md` |
| `serverdoctor/` | Diagnóstico offline | ❌ (requiere archivos) | `serverdoctor/EVALUACION.md` |
| `vaultbreaker/` | Escáner de exposición (Python) | ✅ `passive`/`probe` | `vaultbreaker/EVALUACION.md` |

## 2. Ofensivos (documentan la primitiva exacta)

| Carpeta | Tipo | Qué aporta | Evaluación |
|---|---|---|---|
| `du-addon-public/` | Addon Meteor (dúpes/crashes) | `PacketDelay` exacto, `BundleDupe`, **TradeDupe (AxTrade)** | `du-addon-public/EVALUACION.md` |
| `wakDuper/` | Mod Fabric (1.21.1) | soft-close, desync, delay, send-and-quit, fabricate | `wakDuper/EVALUACION.md` |
| `ui-utils/` | Mod Fabric (original) | chat-in-GUI + delay + fabricate packet | `ui-utils/EVALUACION.md` |
| `papermc-dupe/` | Mod Fabric (exploit Paper) | pickup timer desync + rejoin | `papermc-dupe/EVALUACION.md` |

> `florianreuth/UI-Utils-Reborn` está archivado/404; se usó `Coderx-Gamer/ui-utils` (el original que cita su README).

## 3. Métodos (M1–M11)

Definidos en `../EXPLOIT-METHODS.md` (Parte 2).

| Método | Clase | Herramienta objetivo |
|---|---|---|
| M1 | disconnect-mid-transaction (save race) | auctionhouse |
| M2 | confirmation-GUI race | auctionhouse |
| M3 | numeric overflow/NaN/negativo | auctionhouse, cf, shop |
| M4 | cooldown persistence bypass | cmi kits, dailyrewards |
| M5 | packet reorder (blink) | cf (GUI), kits, lotería |
| M6 | cross-backend save race | auctionhouse, eco |
| M7 | permission re-check bypass | kits (negativo), crates |
| M8 | stack/quantity edge | ah, ec, mochila |
| M9 | preview/open mismatch | excellentcrates |
| M10 | refund/tax rounding | cf, lotería, ah |
| M11 | NBT/custom item abuse | oraxen, itemedit |

## 4. Skills (playbooks por técnica)

| Skill | Técnica |
|---|---|
| `../skills/save-race.md` | M1/M2 |
| `../skills/economy-overflow.md` | M3/M10 |
| `../skills/cooldown-bypass.md` | M4 |
| `../skills/packet-delay.md` | M5 |
| `../skills/permission-bypass.md` | M7 |
| `../skills/reconciliation.md` | M8 + detección |

## 5. Código de referencia (snippets)

| Archivo | Origen | Qué es |
|---|---|---|
| `snippets/packet-race.js` | propio | `window_click` crudo con delay/reorden/flush (M1/M5) |
| `snippets/reconcile.js` | propio (inspirado en BetterAntiDupe) | reconciliación de inventario, solo lectura |
| `snippets/exposure-check.js` | propio (inspirado en VaultBreaker) | chequeo pasivo RCON/Query/Dynmap |
| `snippets/packet-delay-queue.java` | `du-addon-public` | cola de C2S + flush (primitiva del blink) |
| `snippets/clear-active-item.java` | `BundleDupeV3Fix` | `clearActiveItem()` en quit |
| `snippets/click-rate-limit.java` | `ExploitShield` | rate-limit de clics (80/900 ms) |
| `snippets/README.md` | — | índice y notas |

## 6. Grafo

`research/GRAPH.md` (Mermaid): herramienta → clase → método → plugin.

## 7. Fuentes de los repos clonados

Se bajaron como clones git el 2026-11-16 aprox.; los `.git` internos se
eliminaron al versionar el proyecto (evita gitlinks rotos). Origen de cada uno:

| Carpeta | URL |
|---|---|
| `ExploitShield/` | https://github.com/Its-Rango/ExploitShield |
| `BundleDupeV3Fix/` | https://github.com/ruViolence/BundleDupeV3Fix |
| `BetterAntiDupe/` | https://github.com/ESMP-FUN/BetterAntiDupe |
| `serverdoctor/` | https://github.com/SalyyS1/serverdoctor |
| `du-addon-public/` | https://github.com/YAYLOLDEV/du-addon-public |
| `wakDuper/` | https://github.com/me-jndildap/wakDuper |
| `ui-utils/` | https://github.com/Coderx-Gamer/ui-utils |
| `papermc-dupe/` | https://github.com/mrbreaknfix/papermc-dupe |

> `vaultbreaker/` no era un clon (release/wheel suelto); su procedencia está
> documentada en `vaultbreaker/EVALUACION.md`.
