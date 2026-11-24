# VaultBreaker — evaluación de funcionamiento

**Distribución:** PyPI (`vaultbreaker`, v1.4.0, wheel descargado en `research/vaultbreaker/`).

## Qué hace

Escáner de seguridad de red para servidores Minecraft, con niveles de ética:

| Nivel | Flag | Alcance |
|---|---|---|
| `passive` | `--ethics-level passive` | SLP ping + UDP query (sin sweep) |
| `probe` (default) | `--ethics-level probe` | + TCP sweep de 9 puertos, RakNet, HTTP (Dynmap) |
| `active` | `--ethics-level active` | + RCON TCP probe, sweep ampliado |

## Chequeos relevantes (mapeados a black-box)

| Check | Severidad | Qué detecta |
|---|---|---|
| `cracked-server` | HIGH | offline-mode (conexión no autenticada) |
| `query-exposed` | MEDIUM | UDP Query filtra jugadores/plugins |
| `outdated-version` | MEDIUM | versión con CVEs conocidas |
| `log4shell` | CRITICAL | fingerprint CVE-2021-44228 |
| `rcon-exposed` | HIGH | RCON (25575) acepta TCP |
| `dynmap-exposed` | MEDIUM | Dynmap accesible sin auth |
| `bungeecord-bypass` | HIGH | ip_forward sin firewall |
| `plugin-cve` | HIGH | nombre/versión matchea CVE |

## Evaluación

- **Aplicable black-box en niveles `passive`/`probe`**: un solo TCP/UDP por servicio, sin flooding. Equivale a nuestro `tools/exposure-check.js`.
- **Límite ético**: solo contra sistemas propios/autorizados. Chequear RCON/Query/Dynmap de un servidor propio o con autorización escrita es legítimo; tratalo siempre como **propuesta pendiente de OK** (toca red).
- `plugin-cve` es exactamente lo que propusimos como `tools/cve-check.js`, con la salvedad de que necesitamos la **versión** de cada plugin (ver `version-probe.js`).

**Veredicto:** plantilla para `exposure-check.js` y `cve-check.js`; niveles `passive`/`probe` son la cota de lo que podemos hacer por red sin violar el alcance.
