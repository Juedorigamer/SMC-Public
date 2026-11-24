# serverdoctor — evaluación de funcionamiento

**Repo:** `SalyyS1/serverdoctor` · **Tipo:** diagnóstico offline (CLI Java) sobre los artefactos ya producidos por el server.

## Qué hace

Lee la carpeta del servidor (log, `.log.gz`, configs, start script, jars de plugins, worlds, crash reports, listas de acceso) **sin arrancar el server ni conectarse**. Escribe solo el reporte.

| Comando | Qué responde |
|---|---|
| `scan` | Todo en una pasada |
| `log` | Qué falló, qué plugin fue el culpable, con atribución |
| `config` | ¿Está expuesto o mal configurado? (server.properties + bukkit/spigot/paper juntos) |
| `flags` | ¿Los flags JVM hacen lo que crees? |
| `plugins` | Qué está instalado, qué está roto, de dónde vino cada jar |
| `world` | ¿Region files con sectores válidos? ¿versiones coherentes? |
| `crash` | Qué dice el crash report, de quién es el código |
| `perms` | ¿Quién entra, quién es op, se verifica la identidad? |
| `diff` | Qué difiere entre dos servers "iguales" |

## Evaluación

- **Fuera del alcance black-box**: requiere los archivos del servidor (log/config/jars/world), que no tenemos.
- **Útil si el cliente nos pasa una carpeta/log** más adelante: el `log` con atribución de plugin y el `config` (offline-mode + ops, proxy forwarding) son exactamente los hallazgos de seguridad que no podemos ver por red.
- Notas valiosas que aplica también a la interpretación de logs: "la ausencia de warning no es buena noticia" (Paper borra `Can't keep up!`), y "un setting puede parecer activo y no hacer nada" (`timeout-time: -1` → Paper usa 300 s).

**Veredicto:** referencia para una fase con acceso a archivos; no aplicable ahora, pero su checklist de config/perms es reutilizable.
