# Skill — Bypass de permisos en GUI (CWE-862)

**Método:** M7 · **Herramienta:** `recon.js --click-slot` / `packet-race.js`

## Causa raíz

El menú muestra "NO TIENES ACCESO" (o cooldown), pero el handler de clic **no re-valida** el permiso/cooldown en el servidor. Falta de autorización (CWE-862) o de ownership.

## Señales en el objetivo

- Kits con "NO TIENES ACCESO" en `/kitpreview`.
- QuickShop `/chestshop permission` sin chequeo de dueño (escalada a AdminShop) — CVE de QuickShop.
- Crates/shops con ítems por permiso.

## Prueba

1. Abrir la GUI y clicar un ítem marcado sin acceso.
2. Comparar inventario/saldo.
3. En QuickShop: `/chestshop permission` sobre un shop ajeno → verificar si se puede tomar control.

## Estado en el objetivo

- Kits: **ya probado** — clic en "Che" (NO TIENES ACCESO) no entregó ítems → permiso aplicado. Descartado para kits.
- QuickShop: pendiente (requiere cofre + shop ajeno; además roza la interacción con terceros).

## Referencia

- CVE-2024-48645 (missing authorization).
- QuickShop per-player permission exploit (missing ownership check).
