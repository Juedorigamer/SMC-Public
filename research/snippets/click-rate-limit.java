// click-rate-limit.java — patrón ExploitShield (referencia, no se compila en el bot).
// Rate-limit de CLICK_WINDOW: bloquea ráfagas que usan los dupe clients.
package dev.exploit.shield.packet;

import com.github.retrooper.packetevents.event.PacketListenerAbstract;
import com.github.retrooper.packetevents.event.PacketReceiveEvent;
import com.github.retrooper.packetevents.protocol.packettype.PacketType;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class ClickWindowRateLimit extends PacketListenerAbstract {
    private final Map<UUID, Integer> clicks = new ConcurrentHashMap<>();
    private final Map<UUID, Long> resetAt = new ConcurrentHashMap<>();
    private static final int MAX_PACKETS = 80;
    private static final long INTERVAL_MS = 900;

    @Override
    public void onPacketReceive(PacketReceiveEvent e) {
        if (e.getPacketType() != PacketType.Play.Client.CLICK_WINDOW) return;
        if (e.getPlayer() == null) return;
        UUID id = e.getPlayer().getUniqueId();
        long now = System.currentTimeMillis();
        long last = resetAt.getOrDefault(id, now);
        if (now - last >= INTERVAL_MS) { clicks.put(id, 0); resetAt.put(id, now); }
        int count = clicks.getOrDefault(id, 0) + 1;
        clicks.put(id, count);
        if (count > MAX_PACKETS) {
            e.setCancelled(true); // bloquea la ráfaga
        }
    }
}
