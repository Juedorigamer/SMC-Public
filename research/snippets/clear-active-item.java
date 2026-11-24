// clear-active-item.java — patrón BundleDupeV3Fix (referencia, no se compila en el bot).
// Neutraliza la race "flood + use item + kick" limpiando el estado activo al salir.
package ru.violence.bundledupev3fix;

import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

public class BundleDupeV3FixPlugin extends JavaPlugin implements Listener {
    @Override
    public void onEnable() {
        getServer().getPluginManager().registerEvents(this, this);
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onPlayerQuit(PlayerQuitEvent event) {
        event.getPlayer().clearActiveItem();
    }
}
